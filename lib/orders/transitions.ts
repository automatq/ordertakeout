import "server-only";

import { after } from "next/server";

import { and, eq, isNull, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import { loyaltyEntries, orders, slotHolds, type Order, type OrderStatus } from "@/lib/db/schema";
import { REWARD_POINTS } from "@/lib/accounts/loyalty";
import { isDemoMode } from "@/lib/demo/config";
import { reportError } from "@/lib/monitoring/report";
import { squareClient } from "@/lib/square/client";
import { STAFF_TRANSITIONS } from "@/lib/orders/status";
import { notifyOrder } from "@/lib/notifications/dispatch";
import {
  PARTIAL_REFUND_ERROR_PREFIX,
  shouldApplyStatus,
} from "@/lib/webhooks/events";
import {
  cancelSquarePaymentAttempt,
  refundSquarePayment,
} from "@/lib/square/orders";
import {
  createRefundAttemptKey,
  isAttemptLeaseStale,
  isPaymentAttemptMarker,
} from "@/lib/orders/payment-state";
import { releaseInventoryHoldsWithin } from "@/lib/inventory/reservations";

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
  | { ok: true; status: OrderStatus; squareWarning?: string; notice?: string }
  | { ok: false; reason: string };

export async function advanceOrder(
  orderId: string,
  nextStatus: OrderStatus,
): Promise<TransitionResult> {
  if (nextStatus === "completed") {
    return {
      ok: false,
      reason: "Verify pickup at the counter before completing an order.",
    };
  }

  const [order] = await db().select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return { ok: false, reason: "Order not found." };

  if (order.refundStatus === "pending" && nextStatus !== "canceled") {
    return {
      ok: false,
      reason: "This order is locked while Square finishes its refund.",
    };
  }

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
    .where(and(
      eq(orders.id, orderId),
      eq(orders.status, order.status),
      ne(orders.refundStatus, "pending"),
    ))
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
    return cancelPendingPaymentOrder(order, now);
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

  if (
    order.refundStatus === "failed" &&
    order.refundError?.startsWith(PARTIAL_REFUND_ERROR_PREFIX)
  ) {
    return {
      ok: false,
      reason: "Square already recorded a partial refund. Reconcile the remaining balance in Square before changing this order.",
    };
  }

  const attempt = await claimRefundAttempt(order, now);
  if (!attempt.ok) return attempt.result;

  const refund = await refundSquarePayment({
    paymentId: order.squarePaymentId,
    amountCents: order.totalCents,
    currency: order.currency,
    idempotencyKey: attempt.key,
    reason: `Order ${order.orderNumber} cancelled by staff`,
  });

  if (!refund.ok) {
    if (refund.certainty === "ambiguous") {
      await db()
        .update(orders)
        .set({
          refundError: `Awaiting Square reconciliation: ${refund.code}: ${refund.message}`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(orders.id, order.id),
          eq(orders.status, order.status),
          eq(orders.refundStatus, "pending"),
          eq(orders.refundAttemptKey, attempt.key),
        ));
      return resolveRefundRace(order, attempt.key, {
        pendingNotice: "Square's refund response is delayed. The order remains locked while the same refund attempt is reconciled; do not refund it again manually.",
      });
    }

    const failed = await db()
      .update(orders)
      .set({
        refundStatus: "failed",
        refundError: `${refund.code}: ${refund.message}`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(orders.id, order.id),
        eq(orders.status, order.status),
        eq(orders.refundStatus, "pending"),
        eq(orders.refundAttemptKey, attempt.key),
        isNull(orders.squareRefundId),
      ))
      .returning({ id: orders.id });
    if (!failed.length) return resolveRefundRace(order, attempt.key);
    return {
      ok: false,
      reason: `Square rejected the refund (${refund.message}). The order remains active; retrying will use a new refund attempt.`,
    };
  }

  if (refund.disposition === "failed") {
    const failed = await db()
      .update(orders)
      .set({
        squareRefundId: refund.refundId,
        refundStatus: "failed",
        refundError: `Square refund ${refund.status ?? "UNKNOWN"}`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(orders.id, order.id),
        eq(orders.status, order.status),
        eq(orders.refundStatus, "pending"),
        eq(orders.refundAttemptKey, attempt.key),
      ))
      .returning({ id: orders.id });
    if (!failed.length) return resolveRefundRace(order, attempt.key);
    return {
      ok: false,
      reason: `Square reported that the refund was ${refund.status?.toLowerCase() ?? "unsuccessful"}. The order remains active.`,
    };
  }

  if (refund.disposition === "pending" || refund.disposition === "unknown") {
    const recorded = await db()
      .update(orders)
      .set({
        squareRefundId: refund.refundId,
        refundError: refund.disposition === "unknown"
          ? `Square returned an unknown refund status: ${refund.status ?? "missing"}`
          : null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(orders.id, order.id),
        eq(orders.status, order.status),
        eq(orders.refundStatus, "pending"),
        eq(orders.refundAttemptKey, attempt.key),
      ))
      .returning({ id: orders.id });

    if (!recorded.length) return resolveRefundRace(order, attempt.key);

    return {
      ok: true,
      status: order.status,
      notice: refund.disposition === "pending"
        ? "Square accepted the refund and is still processing it. This order is locked until Square confirms the money was returned."
        : "Square returned an unfamiliar refund state. The order remains locked for manual reconciliation; do not issue another refund.",
    };
  }

  const canceledAt = new Date();
  const updated = await db().transaction(async (tx) => {
    const rows = await tx
      .update(orders)
      .set({
        status: "canceled",
        squareRefundId: refund.refundId,
        refundStatus: "completed",
        refundError: null,
        refundAttemptStartedAt: null,
        canceledAt,
        updatedAt: canceledAt,
      })
      .where(and(
        eq(orders.id, order.id),
        eq(orders.status, order.status),
        eq(orders.refundStatus, "pending"),
        eq(orders.refundAttemptKey, attempt.key),
      ))
      .returning({ id: orders.id });
    if (rows.length) await releaseInventoryHoldsWithin(tx, order.id);
    // A reward reservation is spent when an order is started. If Square has
    // refunded it, restore those points in an auditable, idempotent entry.
    if (rows.length && order.customerAccountId) {
      const [redemption] = await tx.select({ id: loyaltyEntries.id }).from(loyaltyEntries).where(and(
        eq(loyaltyEntries.orderId, order.id),
        eq(loyaltyEntries.kind, "redeemed"),
      )).limit(1);
      if (redemption) {
        await tx.insert(loyaltyEntries).values({
          customerAccountId: order.customerAccountId,
          orderId: order.id,
          kind: "reversed",
          points: REWARD_POINTS,
        }).onConflictDoNothing();
      }
    }
    return rows;
  });

  if (!updated.length) {
    return resolveRefundRace(order, attempt.key);
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

async function cancelPendingPaymentOrder(
  order: Order,
  now: Date,
): Promise<TransitionResult> {
  const marker = isPaymentAttemptMarker(order.squarePaymentId);
  if (marker) {
    if (
      !order.paymentAttemptKey ||
      !isAttemptLeaseStale(order.paymentAttemptStartedAt ?? order.updatedAt, now)
    ) {
      return {
        ok: false,
        reason: "Payment is still processing. Wait a moment before cancelling this order.",
      };
    }

    const remote = await cancelSquarePaymentAttempt(order.paymentAttemptKey);
    if (!remote.ok) {
      return {
        ok: false,
        reason: "Square could not confirm whether the stale payment attempt was charged. The reservation remains protected; reconcile the payment before cancelling.",
      };
    }
  } else if (order.squarePaymentId || order.paymentAttemptKey) {
    return {
      ok: false,
      reason: "This unpaid order has unresolved payment state. Reconcile it in Square before cancelling.",
    };
  }

  const updated = await db().transaction(async (tx) => {
    const rows = await tx
      .update(orders)
      .set({
        status: "canceled",
        squarePaymentId: null,
        paymentAttemptKey: null,
        paymentAttemptSourceId: null,
        paymentAttemptStartedAt: null,
        canceledAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(orders.id, order.id),
        eq(orders.status, "pending_payment"),
        ne(orders.refundStatus, "pending"),
        marker ? eq(orders.squarePaymentId, order.squarePaymentId!) : isNull(orders.squarePaymentId),
        order.paymentAttemptKey
          ? eq(orders.paymentAttemptKey, order.paymentAttemptKey)
          : isNull(orders.paymentAttemptKey),
      ))
      .returning({ id: orders.id });
    if (rows.length) {
      await tx.delete(slotHolds).where(eq(slotHolds.orderId, order.id));
      await releaseInventoryHoldsWithin(tx, order.id);
    }
    return rows;
  });
  return updated.length
    ? { ok: true, status: "canceled" }
    : { ok: false, reason: "Someone else just updated this order." };
}

type RefundAttemptClaim =
  | { ok: true; key: string }
  | { ok: false; result: TransitionResult };

async function claimRefundAttempt(order: Order, now: Date): Promise<RefundAttemptClaim> {
  if (order.refundStatus === "pending") {
    if (!order.refundAttemptKey) {
      return {
        ok: false,
        result: {
          ok: false,
          reason: "This refund was started outside the app and must finish or be reconciled in Square before another refund is attempted.",
        },
      };
    }
    const key = order.refundAttemptKey;
    const startedAt = order.refundAttemptStartedAt ?? order.updatedAt;
    if (!isAttemptLeaseStale(startedAt, now)) {
      return {
        ok: false,
        result: {
          ok: true,
          status: order.status,
          notice: "Square is still processing this refund. The order remains locked until its final status arrives.",
        },
      };
    }

    const reclaimed = await db()
      .update(orders)
      .set({
        refundAttemptKey: key,
        refundAttemptStartedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(orders.id, order.id),
        eq(orders.status, order.status),
        eq(orders.refundStatus, "pending"),
        order.refundAttemptKey
          ? eq(orders.refundAttemptKey, order.refundAttemptKey)
          : isNull(orders.refundAttemptKey),
        order.refundAttemptStartedAt
          ? eq(orders.refundAttemptStartedAt, order.refundAttemptStartedAt)
          : isNull(orders.refundAttemptStartedAt),
      ))
      .returning({ id: orders.id });
    return reclaimed.length
      ? { ok: true, key }
      : { ok: false, result: { ok: false, reason: "Another refund reconciliation just started." } };
  }

  const key = createRefundAttemptKey();
  const claimed = await db()
    .update(orders)
    .set({
      squareRefundId: null,
      refundAttemptKey: key,
      refundAttemptStartedAt: now,
      refundStatus: "pending",
      refundError: null,
      updatedAt: now,
    })
    .where(and(
      eq(orders.id, order.id),
      eq(orders.status, order.status),
      eq(orders.refundStatus, order.refundStatus),
      order.refundAttemptKey
        ? eq(orders.refundAttemptKey, order.refundAttemptKey)
        : isNull(orders.refundAttemptKey),
    ))
    .returning({ id: orders.id });
  return claimed.length
    ? { ok: true, key }
    : { ok: false, result: { ok: false, reason: "Another refund reconciliation just started." } };
}

async function resolveRefundRace(
  original: Order,
  attemptKey: string,
  options: { pendingNotice?: string } = {},
): Promise<TransitionResult> {
  const [fresh] = await db()
    .select()
    .from(orders)
    .where(eq(orders.id, original.id))
    .limit(1);
  if (!fresh) return { ok: false, reason: "Order not found after refund reconciliation." };

  if (fresh.status === "canceled" && fresh.refundStatus === "completed") {
    const squareWarning = fresh.squareOrderId
      ? await mirrorToSquare(fresh.squareOrderId, "canceled")
      : undefined;
    await db()
      .update(orders)
      .set({ squareSyncError: squareWarning ?? null, updatedAt: new Date() })
      .where(eq(orders.id, fresh.id));
    after(() => notifyOrder(fresh.id, "order_canceled"));
    return { ok: true, status: "canceled", squareWarning };
  }
  if (fresh.refundStatus === "pending" && fresh.refundAttemptKey === attemptKey) {
    return {
      ok: true,
      status: fresh.status,
      notice: options.pendingNotice ?? "Square is still processing this refund. The order remains locked until its final status arrives.",
    };
  }
  if (fresh.refundStatus === "failed") {
    return {
      ok: false,
      reason: fresh.refundError
        ? `Square did not complete the refund (${fresh.refundError}). The order remains active.`
        : "Square did not complete the refund. The order remains active.",
    };
  }
  return {
    ok: false,
    reason: "The refund response raced with another update. Refresh to see its current state.",
  };
}

/**
 * Reflect the change in Square so the POS agrees.
 *
 * Returns a warning string rather than throwing: a Square outage must not make
 * the kitchen screen unusable.
 */
export async function mirrorToSquare(
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
    if (fulfillment.state === state) return undefined;

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
    reportError("orders", `could not mirror ${status} to Square`, cause);
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
