import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { notifyOrder } from "@/lib/notifications/dispatch";
import { orders, slotHolds, webhookEvents } from "@/lib/db/schema";
import type { OrderStatus } from "@/lib/db/schema";

import {
  isPaymentCaptured,
  mapFulfillmentState,
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

export type EventOutcome =
  | { handled: true; detail: string }
  | { handled: false; detail: string };

/**
 * Record the event, or report that it has already been fully processed.
 *
 * Square retries on any non-2xx, and can deliver the same event more than once
 * regardless. The primary key on Square's own event id makes that safe. Note the
 * check is "already *processed*", not "already *seen*" — a previous attempt that
 * recorded the event and then failed mid-processing must be retried, not
 * silently skipped.
 */
export async function claimEvent(
  eventId: string,
  eventType: string,
  body: unknown,
): Promise<{ alreadyProcessed: boolean }> {
  const inserted = await db()
    .insert(webhookEvents)
    .values({ squareEventId: eventId, eventType, body })
    .onConflictDoNothing({ target: webhookEvents.squareEventId })
    .returning({ id: webhookEvents.squareEventId });

  if (inserted.length > 0) return { alreadyProcessed: false };

  const [existing] = await db()
    .select({ processedAt: webhookEvents.processedAt })
    .from(webhookEvents)
    .where(eq(webhookEvents.squareEventId, eventId))
    .limit(1);

  return { alreadyProcessed: Boolean(existing?.processedAt) };
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
    .where(eq(webhookEvents.squareEventId, eventId));
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
  const [order] = await db()
    .select()
    .from(orders)
    .where(eq(orders.squarePaymentId, event.paymentId))
    .limit(1);
  if (!order) return { handled: false, detail: `No local order for payment ${event.paymentId}` };

  if (event.status === "COMPLETED") {
    const now = new Date();
    await db()
      .update(orders)
      .set({
        status: "canceled",
        refundStatus: "completed",
        squareRefundId: event.refundId,
        refundError: null,
        canceledAt: order.canceledAt ?? now,
        updatedAt: now,
      })
      .where(eq(orders.id, order.id));
    await notifyOrder(order.id, "order_canceled");
    return { handled: true, detail: `Refunded and cancelled ${order.orderNumber}` };
  }

  if (event.status === "FAILED" || event.status === "REJECTED") {
    await db()
      .update(orders)
      .set({ refundStatus: "failed", refundError: `Square refund ${event.status}`, updatedAt: new Date() })
      .where(eq(orders.id, order.id));
    return { handled: true, detail: `Refund failed for ${order.orderNumber}` };
  }

  await db()
    .update(orders)
    .set({ refundStatus: "pending", squareRefundId: event.refundId, updatedAt: new Date() })
    .where(eq(orders.id, order.id));
  return { handled: true, detail: `Refund ${event.status ?? "pending"} for ${order.orderNumber}` };
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

  if (order.status !== "pending_payment") {
    return { handled: false, detail: `Order ${order.orderNumber} already ${order.status}` };
  }

  const paidAt = new Date();
  await db().transaction(async (tx) => {
    await tx
      .update(orders)
      .set({
        status: "paid",
        squarePaymentId: event.paymentId,
        paidAt,
        updatedAt: paidAt,
      })
      // Guarded so a concurrent checkout completing normally wins the race
      // rather than both writing.
      .where(sql`${orders.id} = ${order.id} AND ${orders.status} = 'pending_payment'`);

    await tx.delete(slotHolds).where(eq(slotHolds.orderId, order.id));
  });

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


  // Cancelling a paid Square fulfillment does not prove the card payment was
  // refunded. The refund webhook is the financial source of truth and will
  // close the local order once Square reports COMPLETED.
  if (nextStatus === "canceled" && order.squarePaymentId && order.refundStatus !== "completed") {
    return {
      handled: false,
      detail: `Square cancelled ${order.orderNumber}; waiting for a completed refund`,
    };
  }

  await db()
    .update(orders)
    .set({ status: nextStatus, updatedAt: new Date(), ...timestampFor(nextStatus) })
    .where(eq(orders.id, order.id));

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
