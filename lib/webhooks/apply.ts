import "server-only";

import { and, eq, isNotNull, isNull, lt, ne, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { notifyOrder } from "@/lib/notifications/dispatch";
import { orders, slotHolds, webhookEvents } from "@/lib/db/schema";
import type { OrderStatus } from "@/lib/db/schema";
import { isPaymentAttemptMarker } from "@/lib/orders/payment-state";
import { mirrorToSquare } from "@/lib/orders/transitions";
import {
  releaseInventoryHoldsWithin,
  retainInventoryHoldsAfterPaymentWithin,
} from "@/lib/inventory/reservations";

import {
  classifyRefundStatus,
  isExpectedOrderPayment,
  isFullOrderRefund,
  isPaymentCaptured,
  mapFulfillmentState,
  PARTIAL_REFUND_ERROR_PREFIX,
  shouldApplyStatus,
  type SquareWebhookEvent,
} from "./events";

/**
 * Applying webhook events to our own records.
 *
 * Two jobs:
 *
 *  1. **Reconciliation.** If the database write immediately after a successful
 *     payment ever fails, the customer has been charged and our order still says
 *     `pending_payment`. `payment.updated` is the backstop that fixes it without
 *     anyone noticing.
 *
 *  2. **Two-way status sync.** Staff can move an order along in Square Point of
 *     Sale instead of our dashboard. `order.fulfillment.updated` brings those
 *     changes back so both screens agree.
 */

export type EventOutcome = {
  handled: boolean;
  /** The event is valid, but a prerequisite has not landed locally yet. */
  retryable?: boolean;
  detail: string;
};

/**
 * Exclusively claim an event for this worker.
 *
 * Square retries on any non-2xx, and can deliver the same event more than once
 * regardless. The primary key on Square's own event id makes that safe. Note the
 * A duplicate received while the first worker is active must not run in
 * parallel. Failed attempts can be reclaimed immediately; abandoned claims can
 * be reclaimed after a short lease so a crashed function does not strand them.
 */
export async function claimEvent(
  eventId: string,
  eventType: string,
  body: unknown,
): Promise<{ status: "claimed" | "processed" | "busy" }> {
  const now = new Date();
  const inserted = await db()
    .insert(webhookEvents)
    .values({ squareEventId: eventId, eventType, body, receivedAt: now })
    .onConflictDoNothing({ target: webhookEvents.squareEventId })
    .returning({ id: webhookEvents.squareEventId });

  if (inserted.length > 0) return { status: "claimed" };

  const staleBefore = new Date(now.getTime() - 10 * 60_000);
  const reclaimed = await db()
    .update(webhookEvents)
    .set({ receivedAt: now, error: null })
    .where(and(
      eq(webhookEvents.squareEventId, eventId),
      isNull(webhookEvents.processedAt),
      or(isNotNull(webhookEvents.error), lt(webhookEvents.receivedAt, staleBefore)),
    ))
    .returning({ id: webhookEvents.squareEventId });

  if (reclaimed.length > 0) return { status: "claimed" };

  const [existing] = await db()
    .select({ processedAt: webhookEvents.processedAt })
    .from(webhookEvents)
    .where(eq(webhookEvents.squareEventId, eventId))
    .limit(1);

  return { status: existing?.processedAt ? "processed" : "busy" };
}

export async function markEventProcessed(eventId: string): Promise<void> {
  await db()
    .update(webhookEvents)
    .set({ processedAt: new Date(), error: null })
    .where(eq(webhookEvents.squareEventId, eventId));
}

/**
 * Record a processing failure **without** setting `processed_at`.
 *
 * That omission is the whole point: claimEvent() treats a processed event as a
 * duplicate and skips it, so stamping processed_at here would make Square's
 * retry a no-op and strand the order in the wrong state. The error is kept for
 * diagnosis; the event stays eligible for reprocessing.
 */
export async function recordEventError(eventId: string, error: string): Promise<void> {
  await db()
    .update(webhookEvents)
    .set({ error })
    .where(and(eq(webhookEvents.squareEventId, eventId), isNull(webhookEvents.processedAt)));
}

export async function applySquareEvent(event: SquareWebhookEvent): Promise<EventOutcome> {
  switch (event.kind) {
    case "payment":
      return applyPaymentEvent(event);
    case "fulfillment":
      return applyFulfillmentEvent(event);
    case "refund":
      return applyRefundEvent(event);
    case "other":
      return { handled: false, detail: `Ignored event type ${event.type}` };
  }
}

async function applyRefundEvent(
  event: Extract<SquareWebhookEvent, { kind: "refund" }>,
): Promise<EventOutcome> {
  let [order] = await db()
    .select()
    .from(orders)
    .where(eq(orders.squarePaymentId, event.paymentId))
    .limit(1);
  if (!order && event.squareOrderId) {
    [order] = await db()
      .select()
      .from(orders)
      .where(eq(orders.squareOrderId, event.squareOrderId))
      .limit(1);
  }
  if (!order) return { handled: false, detail: `No local order for payment ${event.paymentId}` };

  if (
    (event.squareOrderId !== null && event.squareOrderId !== order.squareOrderId) ||
    (event.locationId !== null && event.locationId !== order.squareLocationId)
  ) {
    return {
      handled: false,
      retryable: true,
      detail: `Refund ${event.refundId} does not match ${order.orderNumber}'s Square order or location`,
    };
  }

  if (event.amountCents === null || event.currency === null) {
    return {
      handled: false,
      retryable: true,
      detail: `Refund ${event.refundId} has no amount or currency for safe reconciliation`,
    };
  }

  const disposition = classifyRefundStatus(event.status);
  const isFullRefund = isFullOrderRefund(
    event.amountCents,
    event.currency,
    order.totalCents,
    order.currency,
  );

  if (
    !(isFullRefund && disposition === "completed") &&
    order.refundStatus === "pending" &&
    order.refundAttemptKey &&
    order.squareRefundId === null
  ) {
    if (!event.createdAt) {
      return {
        handled: false,
        retryable: true,
        detail: `Refund ${event.refundId} cannot yet be correlated to the active attempt for ${order.orderNumber}`,
      };
    }
    const eventAt = new Date(event.createdAt);
    const attemptAt = order.refundAttemptStartedAt ?? order.updatedAt;
    if (eventAt.getTime() < attemptAt.getTime()) {
      return {
        handled: false,
        detail: `Ignored refund ${event.refundId} from an older attempt for ${order.orderNumber}`,
      };
    }
  }

  if (!isFullRefund) return recordPartialRefund(order, event);

  if (disposition === "completed") {
    if (order.status === "canceled" && order.refundStatus === "completed") {
      if (order.squareRefundId === event.refundId) {
        await finishWebhookCancellation(order.id, order.squareOrderId);
        return { handled: true, detail: `Replayed completed refund for ${order.orderNumber}` };
      }
      return {
        handled: false,
        detail: `Ignored completed refund ${event.refundId}; ${order.orderNumber} already has refund ${order.squareRefundId ?? "unknown"}`,
      };
    }

    const now = new Date();
    const updated = await db().transaction(async (tx) => {
      const rows = await tx
        .update(orders)
        .set({
          status: "canceled",
          refundStatus: "completed",
          squarePaymentId: event.paymentId,
          paymentAttemptKey: null,
          paymentAttemptSourceId: null,
          paymentAttemptStartedAt: null,
          squareRefundId: event.refundId,
          refundError: null,
          refundAttemptStartedAt: null,
          canceledAt: order.canceledAt ?? now,
          updatedAt: now,
        })
        .where(and(
          eq(orders.id, order.id),
          order.squarePaymentId === null
            ? isNull(orders.squarePaymentId)
            : eq(orders.squarePaymentId, order.squarePaymentId),
          or(
            ne(orders.refundStatus, "completed"),
            ne(orders.status, "canceled"),
          ),
        ))
        .returning({ id: orders.id });
      if (rows.length) await releaseInventoryHoldsWithin(tx, order.id);
      return rows;
    });
    if (!updated.length) {
      const [fresh] = await db()
        .select()
        .from(orders)
        .where(eq(orders.id, order.id))
        .limit(1);
      if (fresh?.status === "canceled" && fresh.refundStatus === "completed") {
        if (fresh.squareRefundId === event.refundId) {
          await finishWebhookCancellation(fresh.id, fresh.squareOrderId);
          return { handled: true, detail: `Replayed completed refund for ${fresh.orderNumber}` };
        }
        return {
          handled: false,
          detail: `Ignored completed refund ${event.refundId}; ${fresh.orderNumber} already has refund ${fresh.squareRefundId ?? "unknown"}`,
        };
      }
      return {
        handled: false,
        retryable: true,
        detail: `Cancellation for ${order.orderNumber} changed concurrently`,
      };
    }
    await finishWebhookCancellation(order.id, order.squareOrderId);
    return { handled: true, detail: `Refunded and cancelled ${order.orderNumber}` };
  }

  const matchesActiveOrDirectRefund = and(
    eq(orders.id, order.id),
    ne(orders.refundStatus, "completed"),
    or(
      ne(orders.refundStatus, "pending"),
      isNull(orders.squareRefundId),
      eq(orders.squareRefundId, event.refundId),
    ),
  );

  if (disposition === "failed") {
    const updated = await db()
      .update(orders)
      .set({
        squareRefundId: event.refundId,
        refundStatus: "failed",
        refundError: `Square refund ${event.status ?? "UNKNOWN"}`,
        refundAttemptStartedAt: null,
        updatedAt: new Date(),
      })
      .where(matchesActiveOrDirectRefund)
      .returning({ id: orders.id });
    return updated.length
      ? { handled: true, detail: `Refund failed for ${order.orderNumber}` }
      : { handled: false, detail: `Ignored stale refund failure for ${order.orderNumber}` };
  }

  const updated = await db()
    .update(orders)
    .set({
      refundStatus: "pending",
      squareRefundId: event.refundId,
      refundError: disposition === "unknown"
        ? `Square returned an unknown refund status: ${event.status ?? "missing"}`
        : null,
      // A refund initiated directly in Square has no app-owned idempotency key.
      // Keeping it null prevents the staff action from inventing a second refund.
      refundAttemptKey: order.refundStatus === "pending" ? order.refundAttemptKey : null,
      refundAttemptStartedAt: order.refundStatus === "pending"
        ? order.refundAttemptStartedAt
        : null,
      updatedAt: new Date(),
    })
    .where(matchesActiveOrDirectRefund)
    .returning({ id: orders.id });
  return updated.length
    ? { handled: true, detail: `Refund ${event.status ?? "unknown"} for ${order.orderNumber}` }
    : { handled: false, detail: `Ignored stale refund update for ${order.orderNumber}` };
}

async function recordPartialRefund(
  order: typeof orders.$inferSelect,
  event: Extract<SquareWebhookEvent, { kind: "refund" }>,
): Promise<EventOutcome> {
  const amount = event.amountCents ?? 0;
  const currency = event.currency ?? "unknown currency";
  const message = `${PARTIAL_REFUND_ERROR_PREFIX} Square refund ${event.refundId} is ${event.status ?? "UNKNOWN"} for ${amount} minor units (${currency}); reconcile the remaining balance manually.`;
  const updated = await db()
    .update(orders)
    .set({
      squareRefundId: event.refundId,
      refundStatus: "failed",
      refundError: message,
      refundAttemptStartedAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(orders.id, order.id),
      ne(orders.refundStatus, "completed"),
      or(
        ne(orders.refundStatus, "pending"),
        isNull(orders.squareRefundId),
        eq(orders.squareRefundId, event.refundId),
      ),
    ))
    .returning({ id: orders.id });
  return updated.length
    ? { handled: true, detail: `Flagged partial refund ${event.refundId} for manual reconciliation` }
    : { handled: false, detail: `Ignored conflicting partial refund ${event.refundId}` };
}

async function finishWebhookCancellation(
  orderId: string,
  squareOrderId: string | null,
): Promise<void> {
  const squareWarning = squareOrderId
    ? await mirrorToSquare(squareOrderId, "canceled")
    : undefined;
  await db()
    .update(orders)
    .set({ squareSyncError: squareWarning ?? null, updatedAt: new Date() })
    .where(eq(orders.id, orderId));
  await notifyOrder(orderId, "order_canceled");
}

async function applyPaymentEvent(
  event: Extract<SquareWebhookEvent, { kind: "payment" }>,
): Promise<EventOutcome> {
  if (!isPaymentCaptured(event.status)) {
    return { handled: false, detail: `Payment ${event.paymentId} is ${event.status}` };
  }
  if (!event.squareOrderId) {
    return { handled: false, detail: `Payment ${event.paymentId} has no order` };
  }

  const [order] = await db()
    .select()
    .from(orders)
    .where(eq(orders.squareOrderId, event.squareOrderId))
    .limit(1);

  if (!order) {
    // Payments taken at the counter also emit this event and have no matching
    // online order. Not an error.
    return { handled: false, detail: `No local order for ${event.squareOrderId}` };
  }

  if (!isExpectedOrderPayment({
    amountCents: event.amountCents,
    currency: event.currency,
    locationId: event.locationId,
    referenceId: event.referenceId,
    orderTotalCents: order.totalCents,
    orderCurrency: order.currency,
    orderLocationId: order.squareLocationId,
    orderNumber: order.orderNumber,
  })) {
    return {
      handled: false,
      retryable: true,
      detail: `Completed payment ${event.paymentId} does not match ${order.orderNumber}'s amount, currency, location, or reference`,
    };
  }

  if (order.status !== "pending_payment") {
    if (order.status === "canceled" && order.refundStatus !== "completed") {
      return {
        handled: false,
        retryable: true,
        detail: `Completed payment ${event.paymentId} belongs to canceled order ${order.orderNumber} and requires reconciliation`,
      };
    }
    if (
      order.squarePaymentId === event.paymentId &&
      order.status !== "canceled"
    ) {
      // A previous worker can commit the paid transition and crash before the
      // notification claim. Dispatch is idempotent per order/event/channel.
      await notifyOrder(order.id, "order_paid");
      return { handled: true, detail: `Replayed completed payment for ${order.orderNumber}` };
    }
    return { handled: false, detail: `Order ${order.orderNumber} already ${order.status}` };
  }

  if (
    order.squarePaymentId !== null &&
    !isPaymentAttemptMarker(order.squarePaymentId) &&
    order.squarePaymentId !== event.paymentId
  ) {
    return {
      handled: false,
      retryable: true,
      detail: `Order ${order.orderNumber} already references a different payment`,
    };
  }

  const paidAt = new Date();
  const updated = await db().transaction(async (tx) => {
    const rows = await tx
      .update(orders)
      .set({
        status: "paid",
        squarePaymentId: event.paymentId,
        paymentAttemptKey: null,
        paymentAttemptSourceId: null,
        paymentAttemptStartedAt: null,
        paidAt,
        updatedAt: paidAt,
      })
      // Guarded so a concurrent checkout completing normally wins the race
      // rather than both writing.
      .where(and(
        eq(orders.id, order.id),
        eq(orders.status, "pending_payment"),
        order.squarePaymentId === null
          ? isNull(orders.squarePaymentId)
          : eq(orders.squarePaymentId, order.squarePaymentId),
      ))
      .returning({ id: orders.id });

    if (rows.length) {
      await tx.delete(slotHolds).where(eq(slotHolds.orderId, order.id));
      await retainInventoryHoldsAfterPaymentWithin(tx, order.id, paidAt);
    }
    return rows;
  });

  if (!updated.length) {
    const [fresh] = await db()
      .select()
      .from(orders)
      .where(eq(orders.id, order.id))
      .limit(1);
    if (
      fresh &&
      fresh.status !== "pending_payment" &&
      fresh.status !== "canceled" &&
      fresh.squarePaymentId === event.paymentId
    ) {
      await notifyOrder(fresh.id, "order_paid");
      return { handled: true, detail: `Replayed completed payment for ${fresh.orderNumber}` };
    }
    return {
      handled: false,
      retryable: true,
      detail: `Payment for ${order.orderNumber} changed concurrently`,
    };
  }

  // Reached only when checkout failed to record the payment, so the "order paid"
  // notifications never went out. dispatch() de-duplicates per channel, so this
  // is safe even if checkout did partially notify.
  await notifyOrder(order.id, "order_paid");

  return { handled: true, detail: `Reconciled ${order.orderNumber} to paid` };
}

async function applyFulfillmentEvent(
  event: Extract<SquareWebhookEvent, { kind: "fulfillment" }>,
): Promise<EventOutcome> {
  const nextStatus = mapFulfillmentState(event.newState);
  if (!nextStatus) {
    return { handled: false, detail: `No status mapping for ${event.newState}` };
  }

  const [order] = await db()
    .select()
    .from(orders)
    .where(eq(orders.squareOrderId, event.squareOrderId))
    .limit(1);

  if (!order) {
    return { handled: false, detail: `No local order for ${event.squareOrderId}` };
  }

  if (!shouldApplyStatus(order.status, nextStatus)) {
    return {
      handled: false,
      detail: `Would move ${order.orderNumber} ${order.status} → ${nextStatus}; ignored`,
    };
  }

  // Fulfillment state is operational, not proof of capture. Only a COMPLETED
  // payment event (or the synchronous payment response) may make an unpaid
  // order paid. An unpaid Square cancellation can still release the hold.
  if (order.status === "pending_payment" && nextStatus !== "canceled") {
    return {
      handled: false,
      retryable: true,
      detail: `Order ${order.orderNumber} is still awaiting a completed payment`,
    };
  }

  if (
    order.status === "pending_payment" &&
    nextStatus === "canceled" &&
    isPaymentAttemptMarker(order.squarePaymentId)
  ) {
    return {
      handled: false,
      retryable: true,
      detail: `Order ${order.orderNumber} still has an unresolved payment attempt`,
    };
  }

  if (order.refundStatus === "pending") {
    return {
      handled: false,
      detail: `Order ${order.orderNumber} is locked while its refund is pending`,
    };
  }


  // Cancelling a paid Square fulfillment does not prove the card payment was
  // refunded. The refund webhook is the financial source of truth and will
  // close the local order once Square reports COMPLETED.
  if (
    nextStatus === "canceled" &&
    order.squarePaymentId &&
    !isPaymentAttemptMarker(order.squarePaymentId) &&
    order.refundStatus !== "completed"
  ) {
    return {
      handled: false,
      detail: `Square cancelled ${order.orderNumber}; waiting for a completed refund`,
    };
  }

  const updated = await db().transaction(async (tx) => {
    const rows = await tx
      .update(orders)
      .set({ status: nextStatus, updatedAt: new Date(), ...timestampFor(nextStatus) })
      .where(and(
        eq(orders.id, order.id),
        eq(orders.status, order.status),
        ne(orders.refundStatus, "pending"),
      ))
      .returning({ id: orders.id });
    if (rows.length && nextStatus === "canceled") {
      await tx.delete(slotHolds).where(eq(slotHolds.orderId, order.id));
      await releaseInventoryHoldsWithin(tx, order.id);
    }
    return rows;
  });

  if (!updated.length) {
    return {
      handled: false,
      retryable: true,
      detail: `Order ${order.orderNumber} changed concurrently`,
    };
  }

  return { handled: true, detail: `${order.orderNumber}: ${order.status} → ${nextStatus}` };
}

/** Keep the lifecycle timestamps in step with the status. */
function timestampFor(status: OrderStatus): Partial<typeof orders.$inferInsert> {
  const now = new Date();
  switch (status) {
    case "ready":
      return { readyAt: now };
    case "completed":
      return { completedAt: now };
    case "canceled":
      return { canceledAt: now };
    default:
      return {};
  }
}
