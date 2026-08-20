import "server-only";

import { after } from "next/server";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { orders, slotHolds, type Order, type OrderStatus } from "@/lib/db/schema";
import { isDemoMode } from "@/lib/demo/config";
import { squareClient } from "@/lib/square/client";
import { STAFF_TRANSITIONS } from "@/lib/orders/status";
import { notifyOrder } from "@/lib/notifications/dispatch";
import { shouldApplyStatus } from "@/lib/webhooks/events";
import { refundSquarePayment } from "@/lib/square/orders";

export { STAFF_TRANSITIONS };

/**
 * Moving an order along the lifecycle.
 *
 * Writes to our database first, then mirrors to Square. The order matters: the
 * kitchen screen must respond instantly to a tap, and it must keep working when
 * Square is briefly unreachable. If the Square call fails the local change
 * stands and a warning is surfaced — the `order.fulfillment.updated` webhook
 * reconciles the two later, and the forward-only guard in shouldApplyStatus
 * stops a stale Square state ever knocking the order backwards.
 */

/**
 * Our status → Square pickup fulfillment state.
 *
 * `preparing` maps to nothing on purpose. Square's fulfillment has no equivalent
 * — it goes RESERVED straight to PREPARED — so we hold "Preparing" locally and
 * leave Square showing the order as active. This is the one place the two models
 * genuinely differ, and it's worth telling the client plainly.
 */
const SQUARE_STATE: Record<OrderStatus, string | null> = {
  pending_payment: null,
  paid: null, // Square sets RESERVED itself when payment lands.
  preparing: null,
  ready: "PREPARED",
  completed: "COMPLETED",
  canceled: "CANCELED",
};

export type TransitionResult =
  | { ok: true; status: OrderStatus; squareWarning?: string }
  | { ok: false; reason: string };

export async function advanceOrder(
  orderId: string,
  nextStatus: OrderStatus,
): Promise<TransitionResult> {
  const [order] = await db().select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return { ok: false, reason: "Order not found." };

  if (!STAFF_TRANSITIONS[order.status].includes(nextStatus)) {
    return {
      ok: false,
      reason: `Can't move an order from ${order.status} to ${nextStatus}.`,
    };
  }
  if (!shouldApplyStatus(order.status, nextStatus)) {
    return { ok: false, reason: `Order is already ${order.status}.` };
  }

  if (nextStatus === "canceled") {
    return cancelOrder(order);
  }

  const now = new Date();
  const updated = await db()
    .update(orders)
    .set({ status: nextStatus, updatedAt: now, ...timestampFor(nextStatus, now) })
    // Guarded on the status we read, so two staff tapping at once can't both win.
    .where(sql`${orders.id} = ${orderId} AND ${orders.status} = ${order.status}`)
    .returning({ id: orders.id });

  if (updated.length === 0) {
    return { ok: false, reason: "Someone else just updated this order." };
  }

  // "Ready for pickup" is the one the customer is waiting on; cancellation is
  // the one they need to know about. Starting preparation is internal.
  if (nextStatus === "ready") {
    after(() => notifyOrder(orderId, "order_ready"));
  }

  const squareWarning = order.squareOrderId
    ? await mirrorToSquare(order.squareOrderId, nextStatus)
    : undefined;

  await db()
    .update(orders)
    .set({ squareSyncError: squareWarning ?? null, updatedAt: new Date() })
    .where(eq(orders.id, order.id));

  return { ok: true, status: nextStatus, squareWarning };
}

/**
 * A paid order is cancelled only after Square accepts its full refund. Keeping
 * the order active on refund failure prevents the dashboard and customer page
 * from promising money has been returned when it has not.
 */
async function cancelOrder(order: Order): Promise<TransitionResult> {
  const now = new Date();

  if (order.status === "pending_payment") {
    const updated = await db().transaction(async (tx) => {
      const rows = await tx
        .update(orders)
        .set({ status: "canceled", canceledAt: now, updatedAt: now })
        .where(sql`${orders.id} = ${order.id} AND ${orders.status} = ${order.status}`)
        .returning({ id: orders.id });
      if (rows.length) await tx.delete(slotHolds).where(eq(slotHolds.orderId, order.id));
      return rows;
    });
    return updated.length
      ? { ok: true, status: "canceled" }
      : { ok: false, reason: "Someone else just updated this order." };
  }

  if (!order.squarePaymentId) {
    await db()
      .update(orders)
      .set({ refundStatus: "failed", refundError: "Missing Square payment id", updatedAt: now })
      .where(eq(orders.id, order.id));
    return {
      ok: false,
      reason: "This paid order has no Square payment reference. It was not cancelled; reconcile it in Square first.",
    };
  }

  const claimed = await db()
    .update(orders)
    .set({ refundStatus: "pending", refundError: null, updatedAt: now })
    .where(sql`${orders.id} = ${order.id} AND ${orders.status} = ${order.status} AND ${orders.refundStatus} <> 'pending'`)
    .returning({ id: orders.id });
  if (!claimed.length) {
    return { ok: false, reason: "A refund for this order is already being processed." };
  }

  const refund = await refundSquarePayment({
    paymentId: order.squarePaymentId,
    amountCents: order.totalCents,
    currency: order.currency,
    idempotencyKey: `cancel-${order.id}`,
    reason: `Order ${order.orderNumber} cancelled by staff`,
  });

  if (!refund.ok) {
    await db()
      .update(orders)
      .set({ refundStatus: "failed", refundError: `${refund.code}: ${refund.message}`, updatedAt: new Date() })
      .where(eq(orders.id, order.id));
    return {
      ok: false,
      reason: `Square did not accept the refund (${refund.message}). The order remains active and can be retried.`,
    };
  }

  const canceledAt = new Date();
  const updated = await db()
    .update(orders)
    .set({
      status: "canceled",
      squareRefundId: refund.refundId,
      refundStatus: "completed",
      refundError: null,
      canceledAt,
      updatedAt: canceledAt,
    })
    .where(sql`${orders.id} = ${order.id} AND ${orders.status} = ${order.status}`)
    .returning({ id: orders.id });

  if (!updated.length) {
    return {
      ok: false,
      reason: "The refund succeeded, but another staff update won the race. Refresh before continuing.",
    };
  }

  const squareWarning = order.squareOrderId
    ? await mirrorToSquare(order.squareOrderId, "canceled")
    : undefined;
  await db()
    .update(orders)
    .set({ squareSyncError: squareWarning ?? null, updatedAt: new Date() })
    .where(eq(orders.id, order.id));
  after(() => notifyOrder(order.id, "order_canceled"));
  return { ok: true, status: "canceled", squareWarning };
}

/**
 * Reflect the change in Square so the POS agrees.
 *
 * Returns a warning string rather than throwing: a Square outage must not make
 * the kitchen screen unusable.
 */
async function mirrorToSquare(
  squareOrderId: string,
  status: OrderStatus,
): Promise<string | undefined> {
  const state = SQUARE_STATE[status];
  if (!state) return undefined;
  if (isDemoMode()) return undefined;

  try {
    const client = squareClient();
    // Square needs the current version for optimistic concurrency, and the
    // fulfillment's uid — neither of which we store, so read before writing.
    const { order } = await client.orders.get({ orderId: squareOrderId });
    const fulfillment = order?.fulfillments?.[0];

    if (!order || !fulfillment?.uid) {
      return "Order updated here, but Square has no matching fulfillment.";
    }

    await client.orders.update({
      orderId: squareOrderId,
      idempotencyKey: `${squareOrderId}-${state}-${order.version ?? 0}`,
      order: {
        locationId: order.locationId,
        version: order.version,
        fulfillments: [{ uid: fulfillment.uid, state: state as "PREPARED" }],
      },
    });

    return undefined;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[orders] could not mirror ${status} to Square:`, message);
    return "Updated here, but Square didn't accept the change. It will re-sync shortly.";
  }
}

/** Retry a previously failed Square fulfillment mirror without changing status. */
export async function retrySquareOrderSync(orderId: string): Promise<boolean> {
  const [order] = await db().select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order?.squareOrderId || !order.squareSyncError) return false;
  const warning = await mirrorToSquare(order.squareOrderId, order.status);
  await db()
    .update(orders)
    .set({ squareSyncError: warning ?? null, updatedAt: new Date() })
    .where(eq(orders.id, order.id));
  return !warning;
}

function timestampFor(status: OrderStatus, now: Date): Partial<typeof orders.$inferInsert> {
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
