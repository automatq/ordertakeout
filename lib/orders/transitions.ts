import "server-only";

import { after } from "next/server";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { orders, type OrderStatus } from "@/lib/db/schema";
import { squareClient } from "@/lib/square/client";
import { STAFF_TRANSITIONS } from "@/lib/orders/status";
import { notifyOrder } from "@/lib/notifications/dispatch";
import { shouldApplyStatus } from "@/lib/webhooks/events";

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
  if (nextStatus === "ready" || nextStatus === "canceled") {
    const kind = nextStatus === "ready" ? "order_ready" : "order_canceled";
    after(() => notifyOrder(orderId, kind));
  }

  const squareWarning = order.squareOrderId
    ? await mirrorToSquare(order.squareOrderId, nextStatus)
    : undefined;

  return { ok: true, status: nextStatus, squareWarning };
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
