import "server-only";

import { and, eq, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { notifyOrder, notifyOrderRefund } from "@/lib/notifications/dispatch";
import { loyaltyEntries, orders, slotHolds, webhookEvents } from "@/lib/db/schema";
import type { OrderStatus } from "@/lib/db/schema";
import { REWARD_POINTS } from "@/lib/accounts/loyalty";
import { isPaymentAttemptMarker } from "@/lib/orders/payment-state";
import { mirrorToSquare } from "@/lib/orders/transitions";
import {
  markLedgerRowById,
  remainingRefundableCents,
  resolveWebhookLedgerRow,
  revokeEarnedPointsWithin,
  settleLedgerRowWithin,
} from "@/lib/orders/refunds";
import {
  releaseInventoryHoldsWithin,
  retainInventoryHoldsAfterPaymentWithin,
} from "@/lib/inventory/reservations";

import {
  classifyRefundStatus,
  isExpectedOrderPayment,
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

  // Narrowed copies survive into the transaction closures below.
  const amountCents = event.amountCents;
  const currency = event.currency;

  // Money in one currency must never be summed with an order in another.
  if (currency.toUpperCase() !== order.currency.toUpperCase()) {
    await db()
      .update(orders)
      .set({
        refundError: `Square refund ${event.refundId} is in ${currency}; the order is in ${order.currency}. Reconcile manually in Square.`,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, order.id));
    return { handled: true, detail: `Flagged cross-currency refund ${event.refundId} for ${order.orderNumber}` };
  }

  const disposition = classifyRefundStatus(event.status);
  const remainingCents = remainingRefundableCents(order);
  // "Final" now means it refunds the remaining balance — prior partial refunds
  // shrink what a cancellation-completing refund looks like.
  const refundsRemainder = remainingCents > 0 && amountCents === remainingCents;

  const belongsToActiveAttempt =
    order.refundStatus === "pending" &&
    order.refundAttemptKey !== null &&
    (order.squareRefundId === null || order.squareRefundId === event.refundId);

  if (
    !(refundsRemainder && disposition === "completed") &&
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

  const ledger = await resolveWebhookLedgerRow(
    order,
    { refundId: event.refundId, amountCents: amountCents, currency: currency },
    belongsToActiveAttempt,
  );
  if (!ledger) {
    await db()
      .update(orders)
      .set({
        refundError: `Square refund ${event.refundId} arrived while another refund is in flight. Reconcile manually in Square.`,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, order.id));
    return { handled: true, detail: `Flagged concurrent refund ${event.refundId} for ${order.orderNumber}` };
  }

  if (disposition === "completed") {
    if (ledger.status === "completed") {
      // Replay of an already-counted refund: side effects only, never a second bump.
      if (order.status === "canceled" && order.refundStatus === "completed" && order.squareRefundId === event.refundId) {
        await finishWebhookCancellation(order.id, order.squareOrderId);
        return { handled: true, detail: `Replayed completed refund for ${order.orderNumber}` };
      }
      return { handled: true, detail: `Refund ${event.refundId} was already recorded for ${order.orderNumber}` };
    }

    const now = new Date();
    const chargedCents = order.totalCents + order.tipCents;
    const overRefunded = order.refundedTotalCents + amountCents > chargedCents;
    const fullyRefundedAfter = order.refundedTotalCents + amountCents >= chargedCents;
    // A refund of the remaining balance cancels an ACTIVE order; a completed
    // (picked-up) order keeps its status and only its money state changes.
    const shouldCancel = order.status !== "completed" && order.status !== "canceled" && refundsRemainder;

    if (shouldCancel) {
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
            refundedTotalCents: sql`${orders.refundedTotalCents} + ${amountCents}`,
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
        if (!rows.length) return rows;
        await releaseInventoryHoldsWithin(tx, order.id);
        await settleLedgerRowWithin(tx, ledger.id, event.refundId, now);
        // Restore redeemed reward points, same as the staff cancellation path.
        if (order.customerAccountId) {
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

    // Partial refund on any order, or any refund on a completed (picked-up)
    // order: record the money, never touch the lifecycle status.
    const settled = await db().transaction(async (tx) => {
      if (!(await settleLedgerRowWithin(tx, ledger.id, event.refundId, now))) return false;
      await tx
        .update(orders)
        .set({
          refundStatus: fullyRefundedAfter ? "completed" : "partial",
          squareRefundId: event.refundId,
          refundError: overRefunded
            ? `Refunds exceed the charged amount by ${order.refundedTotalCents + amountCents - chargedCents} cents. Reconcile in Square.`
            : null,
          refundAttemptStartedAt: null,
          refundedTotalCents: sql`${orders.refundedTotalCents} + ${amountCents}`,
          updatedAt: now,
        })
        .where(eq(orders.id, order.id));
      if (fullyRefundedAfter && order.status === "completed") {
        await revokeEarnedPointsWithin(tx, order);
      }
      return true;
    });
    if (!settled) {
      return { handled: true, detail: `Refund ${event.refundId} was already recorded for ${order.orderNumber}` };
    }
    await notifyOrderRefund(order.id, ledger.id);
    return {
      handled: true,
      detail: `Recorded ${fullyRefundedAfter ? "final" : "partial"} refund ${event.refundId} for ${order.orderNumber}`,
    };
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
    if (updated.length) {
      await markLedgerRowById(ledger.id, {
        status: "failed",
        squareRefundId: event.refundId,
        error: `Square refund ${event.status ?? "UNKNOWN"}`,
      });
      return { handled: true, detail: `Refund failed for ${order.orderNumber}` };
    }
    return { handled: false, detail: `Ignored stale refund failure for ${order.orderNumber}` };
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
  if (updated.length) {
    await markLedgerRowById(ledger.id, { squareRefundId: event.refundId });
    return { handled: true, detail: `Refund ${event.status ?? "unknown"} for ${order.orderNumber}` };
  }
  return { handled: false, detail: `Ignored stale refund update for ${order.orderNumber}` };
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

  // Square's COMPLETED fulfillment is an operational update, not proof that a
  // customer collected the order. Collection must be recorded through the
  // staffed QR/manual verification flow so we retain the method and initials.
  if (nextStatus === "completed") {
    const warning = "Square shows this order as completed. Verify pickup in the dashboard to close it here.";
    await db()
      .update(orders)
      .set({ squareSyncError: warning, updatedAt: new Date() })
      .where(eq(orders.id, order.id));
    return { handled: false, detail: `${order.orderNumber} needs local pickup verification` };
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
