import { z } from "zod";

import type { OrderStatus } from "@/lib/db/schema";

/**
 * Parsing and interpreting Square webhook events.
 *
 * Pure, so the status transitions can be tested without a database or a live
 * Square account — and they need testing, because getting them wrong silently
 * moves real orders into the wrong state on the kitchen screen.
 *
 * **These schemas are snake_case on purpose.** The Square SDK's TypeScript types
 * (`OrderFulfillmentUpdatedEvent` and friends) are camelCase because the SDK
 * deserialises API responses for you. A webhook is not an SDK response: it
 * arrives as a raw JSON body which we must read verbatim to verify the HMAC
 * signature, and that body is snake_case. Parsing it against the SDK's camelCase
 * shape would compile fine and then never match anything at runtime.
 */

const fulfillmentUpdateSchema = z.object({
  fulfillment_uid: z.string().optional(),
  old_state: z.string().optional(),
  new_state: z.string().optional(),
});

const orderFulfillmentUpdatedSchema = z.object({
  type: z.literal("order.fulfillment.updated"),
  event_id: z.string().min(1),
  created_at: z.string().optional(),
  data: z.object({
    id: z.string().optional(),
    object: z.object({
      order_fulfillment_updated: z.object({
        order_id: z.string().min(1),
        version: z.number().optional(),
        state: z.string().optional(),
        fulfillment_update: z.array(fulfillmentUpdateSchema).optional(),
      }),
    }),
  }),
});

const paymentUpdatedSchema = z.object({
  type: z.enum(["payment.updated", "payment.created"]),
  event_id: z.string().min(1),
  created_at: z.string().optional(),
  data: z.object({
    id: z.string().optional(),
    object: z.object({
      payment: z.object({
        id: z.string().min(1),
        order_id: z.string().optional(),
        status: z.string().optional(),
      }),
    }),
  }),
});

const refundUpdatedSchema = z.object({
  type: z.enum(["refund.created", "refund.updated"]),
  event_id: z.string().min(1),
  data: z.object({
    object: z.object({
      refund: z.object({
        id: z.string().min(1),
        payment_id: z.string().min(1),
        status: z.string().optional(),
      }),
    }),
  }),
});

/** Anything we don't act on, but still record for idempotency and debugging. */
const unknownEventSchema = z.object({
  type: z.string().min(1),
  event_id: z.string().min(1),
});

export type SquareWebhookEvent =
  | { kind: "fulfillment"; eventId: string; type: string; squareOrderId: string; newState: string | null }
  | { kind: "payment"; eventId: string; type: string; paymentId: string; squareOrderId: string | null; status: string | null }
  | { kind: "refund"; eventId: string; type: string; refundId: string; paymentId: string; status: string | null }
  | { kind: "other"; eventId: string; type: string };

export type ParseResult =
  | { ok: true; event: SquareWebhookEvent }
  | { ok: false; reason: string };

export function parseSquareEvent(body: unknown): ParseResult {
  const fulfillment = orderFulfillmentUpdatedSchema.safeParse(body);
  if (fulfillment.success) {
    const payload = fulfillment.data.data.object.order_fulfillment_updated;
    // Square batches updates; the last one is the current state.
    const updates = payload.fulfillment_update ?? [];
    const latest = updates[updates.length - 1];
    return {
      ok: true,
      event: {
        kind: "fulfillment",
        eventId: fulfillment.data.event_id,
        type: fulfillment.data.type,
        squareOrderId: payload.order_id,
        newState: latest?.new_state ?? null,
      },
    };
  }

  const payment = paymentUpdatedSchema.safeParse(body);
  if (payment.success) {
    const paid = payment.data.data.object.payment;
    return {
      ok: true,
      event: {
        kind: "payment",
        eventId: payment.data.event_id,
        type: payment.data.type,
        paymentId: paid.id,
        squareOrderId: paid.order_id ?? null,
        status: paid.status ?? null,
      },
    };
  }

  const refund = refundUpdatedSchema.safeParse(body);
  if (refund.success) {
    const refunded = refund.data.data.object.refund;
    return {
      ok: true,
      event: {
        kind: "refund",
        eventId: refund.data.event_id,
        type: refund.data.type,
        refundId: refunded.id,
        paymentId: refunded.payment_id,
        status: refunded.status ?? null,
      },
    };
  }

  const other = unknownEventSchema.safeParse(body);
  if (other.success) {
    return {
      ok: true,
      event: { kind: "other", eventId: other.data.event_id, type: other.data.type },
    };
  }

  return { ok: false, reason: "Unrecognised webhook payload" };
}

/**
 * Square pickup fulfillment state → our order status.
 *
 * Square has one fewer state than the store asked for: there is no equivalent of
 * "Preparing", which we track ourselves. RESERVED therefore maps to `paid`, and
 * the guard in shouldApplyStatus stops that knocking an order backwards.
 *
 * PROPOSED means the order exists but isn't paid yet, so it carries no status
 * information for us — hence null.
 */
export function mapFulfillmentState(state: string | null): OrderStatus | null {
  switch (state) {
    case "RESERVED":
      return "paid";
    case "PREPARED":
      return "ready";
    case "COMPLETED":
      return "completed";
    case "CANCELED":
    case "FAILED":
      return "canceled";
    default:
      return null;
  }
}

/** Forward progress through the lifecycle. `canceled` is handled separately. */
const STATUS_RANK: Record<Exclude<OrderStatus, "canceled">, number> = {
  pending_payment: 0,
  paid: 1,
  preparing: 2,
  ready: 3,
  completed: 4,
};

/**
 * Whether an incoming status should overwrite the current one.
 *
 * Only forward transitions are applied. This matters because staff marking an
 * order in Square emits RESERVED, which maps to `paid` — without this guard, an
 * order the kitchen had already moved to "Preparing" would jump backwards on the
 * dashboard every time Square sent an update. Cancellation is terminal in both
 * directions: it always applies, and nothing resurrects a cancelled order.
 */
export function shouldApplyStatus(current: OrderStatus, next: OrderStatus): boolean {
  if (current === next) return false;
  if (current === "canceled") return false;
  if (next === "canceled") return true;
  return STATUS_RANK[next] > STATUS_RANK[current];
}

/** Square payment statuses that mean the money is actually captured. */
export function isPaymentCaptured(status: string | null): boolean {
  return status === "COMPLETED" || status === "APPROVED";
}
