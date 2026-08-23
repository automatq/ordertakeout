import "server-only";

import { after } from "next/server";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { loyaltyEntries, orderRefunds, orders, type Order } from "@/lib/db/schema";
import { recordAuditWithin } from "@/lib/audit/log";
import { reportError } from "@/lib/monitoring/report";
import { notifyOrderRefund } from "@/lib/notifications/dispatch";
import { rosterRequiresPin, validateInitials, verifyStaffPin } from "@/lib/staff/roster";
import { refundSquarePayment } from "@/lib/square/orders";
import { createRefundAttemptKey, isAttemptLeaseStale } from "@/lib/orders/payment-state";

/**
 * The refund ledger and the shared refund-attempt claim.
 *
 * Two layers of truth, on purpose:
 * - The `orders.refund_*` columns stay the coarse per-order lock every existing
 *   consumer already checks: one refund in flight (`refundStatus = 'pending'`),
 *   with the attempt-lease semantics from the cancellation flow.
 * - `order_refunds` records every logical refund — cancellation refunds, staff
 *   partial/post-pickup refunds, and refunds issued directly in Square — so the
 *   money history survives beyond the single set of columns. Its partial unique
 *   index (one pending row per order) backs the lock at the database level.
 *
 * The invariant everything here protects: an attempt's idempotency key and
 * amount are pinned together at claim time. A reclaim after a stale lease
 * replays the SAME key with the SAME amount — replaying a key with a different
 * amount would make Square treat it as a conflicting request.
 */

export function remainingRefundableCents(
  order: Pick<Order, "totalCents" | "refundedTotalCents">,
): number {
  return Math.max(0, order.totalCents - order.refundedTotalCents);
}

export type RefundOrigin = "cancellation" | "staff";

export type RefundClaimOutcome =
  | { ok: true; key: string; amountCents: number }
  | { ok: false; kind: "external_pending" }
  | { ok: false; kind: "in_flight" }
  | { ok: false; kind: "raced" };

/**
 * Claim exclusive ownership of the order's refund attempt.
 *
 * Fresh claims persist the requested amount on a pending ledger row inside the
 * same transaction as the orders-columns lock; reclaims of a stale attempt
 * return the ORIGINAL amount from the ledger regardless of what the caller
 * asked for now.
 */
export async function claimRefund(
  order: Order,
  now: Date,
  options: {
    amountCents: number;
    origin: RefundOrigin;
    initiatedBy?: string | null;
    reason?: string | null;
  },
): Promise<RefundClaimOutcome> {
  if (order.refundStatus === "pending") {
    if (!order.refundAttemptKey) return { ok: false, kind: "external_pending" };
    const startedAt = order.refundAttemptStartedAt ?? order.updatedAt;
    if (!isAttemptLeaseStale(startedAt, now)) return { ok: false, kind: "in_flight" };
    return reclaimStaleRefund(order, now);
  }

  const key = createRefundAttemptKey();
  try {
    return await db().transaction(async (tx) => {
      const claimed = await tx
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
      if (!claimed.length) return { ok: false, kind: "raced" } as const;

      // The partial unique index (one pending row per order) is the backstop
      // against a webhook-created pending row racing this insert.
      await tx.insert(orderRefunds).values({
        orderId: order.id,
        attemptKey: key,
        origin: options.origin,
        amountCents: options.amountCents,
        currency: order.currency,
        status: "pending",
        reason: options.reason ?? null,
        initiatedBy: options.initiatedBy ?? null,
        attemptStartedAt: now,
      });
      return { ok: true, key, amountCents: options.amountCents } as const;
    });
  } catch (cause) {
    if (isUniqueViolation(cause)) return { ok: false, kind: "raced" };
    throw cause;
  }
}

async function reclaimStaleRefund(order: Order, now: Date): Promise<RefundClaimOutcome> {
  const key = order.refundAttemptKey!;
  const reclaimed = await db()
    .update(orders)
    .set({ refundAttemptKey: key, refundAttemptStartedAt: now, updatedAt: now })
    .where(and(
      eq(orders.id, order.id),
      eq(orders.status, order.status),
      eq(orders.refundStatus, "pending"),
      eq(orders.refundAttemptKey, key),
      order.refundAttemptStartedAt
        ? eq(orders.refundAttemptStartedAt, order.refundAttemptStartedAt)
        : isNull(orders.refundAttemptStartedAt),
    ))
    .returning({ id: orders.id });
  if (!reclaimed.length) return { ok: false, kind: "raced" };

  const [row] = await db()
    .select({ amountCents: orderRefunds.amountCents })
    .from(orderRefunds)
    .where(eq(orderRefunds.attemptKey, key))
    .limit(1);
  if (row) {
    await db()
      .update(orderRefunds)
      .set({ attemptStartedAt: now, updatedAt: now })
      .where(eq(orderRefunds.attemptKey, key));
    return { ok: true, key, amountCents: row.amountCents };
  }

  // A pre-ledger attempt (or a crash between the two writes). Recreate the row
  // with the remainder — which is what that attempt was for.
  const amountCents = remainingRefundableCents(order);
  await db()
    .insert(orderRefunds)
    .values({
      orderId: order.id,
      attemptKey: key,
      origin: "cancellation",
      amountCents: Math.max(1, amountCents),
      currency: order.currency,
      status: "pending",
      attemptStartedAt: now,
    })
    .onConflictDoNothing();
  return { ok: true, key, amountCents: Math.max(1, amountCents) };
}

/** Best-effort ledger sync for non-final outcomes; the orders columns stay authoritative. */
export async function markLedgerAttempt(
  key: string,
  patch: { squareRefundId?: string | null; status?: "pending" | "failed"; error?: string | null },
): Promise<void> {
  try {
    await db()
      .update(orderRefunds)
      .set({
        ...(patch.squareRefundId !== undefined ? { squareRefundId: patch.squareRefundId } : {}),
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
        updatedAt: new Date(),
      })
      .where(eq(orderRefunds.attemptKey, key));
  } catch (cause) {
    reportError("refunds", "could not sync ledger attempt", cause, { key });
  }
}

type LedgerExecutor = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/**
 * Mark the attempt's ledger row completed inside the caller's transaction.
 * Returns the row id for per-refund notification dedupe.
 */
export async function settleLedgerCompletedWithin(
  tx: LedgerExecutor,
  orderId: string,
  key: string,
  squareRefundId: string | null,
  amountCents: number,
  completedAt: Date,
): Promise<string | null> {
  const updated = await tx
    .update(orderRefunds)
    .set({ status: "completed", squareRefundId, error: null, completedAt, updatedAt: completedAt })
    .where(and(eq(orderRefunds.attemptKey, key), eq(orderRefunds.status, "pending")))
    .returning({ id: orderRefunds.id });
  if (updated.length) return updated[0]!.id;

  // Pre-ledger attempt: record the completion so history stays whole.
  const inserted = await tx
    .insert(orderRefunds)
    .values({
      orderId,
      attemptKey: key,
      origin: "cancellation",
      amountCents: Math.max(1, amountCents),
      currency: "",
      status: "completed",
      squareRefundId,
      completedAt,
    })
    .onConflictDoNothing()
    .returning({ id: orderRefunds.id });
  return inserted[0]?.id ?? null;
}

/** Claw back earned points when a verified pickup is later refunded in full. */
export async function revokeEarnedPointsWithin(tx: LedgerExecutor, order: Order): Promise<void> {
  if (!order.customerAccountId) return;
  const [earned] = await tx
    .select({ points: loyaltyEntries.points })
    .from(loyaltyEntries)
    .where(and(eq(loyaltyEntries.orderId, order.id), eq(loyaltyEntries.kind, "earned")))
    .limit(1);
  if (!earned || earned.points <= 0) return;
  await tx
    .insert(loyaltyEntries)
    .values({
      customerAccountId: order.customerAccountId,
      orderId: order.id,
      kind: "revoked",
      points: -earned.points,
    })
    .onConflictDoNothing();
}

export interface WebhookLedgerRow {
  id: string;
  status: "pending" | "completed" | "failed";
  amountCents: number;
}

/**
 * Find (or create) the ledger row a Square refund event belongs to:
 * by Square refund id first, then the order's active app attempt, else a new
 * `external` row for a refund issued directly in Square. Returns null only
 * when an external row cannot be created because another refund is already
 * pending on the order — genuinely concurrent refunds needing a human.
 */
export async function resolveWebhookLedgerRow(
  order: Order,
  event: { refundId: string; amountCents: number; currency: string },
  belongsToActiveAttempt: boolean,
): Promise<WebhookLedgerRow | null> {
  const select = {
    id: orderRefunds.id,
    status: orderRefunds.status,
    amountCents: orderRefunds.amountCents,
  };

  const [byRefundId] = await db()
    .select(select)
    .from(orderRefunds)
    .where(eq(orderRefunds.squareRefundId, event.refundId))
    .limit(1);
  if (byRefundId) return byRefundId as WebhookLedgerRow;

  if (belongsToActiveAttempt && order.refundAttemptKey) {
    const [byKey] = await db()
      .select(select)
      .from(orderRefunds)
      .where(eq(orderRefunds.attemptKey, order.refundAttemptKey))
      .limit(1);
    if (byKey) {
      await db()
        .update(orderRefunds)
        .set({ squareRefundId: event.refundId, updatedAt: new Date() })
        .where(and(eq(orderRefunds.id, byKey.id), isNull(orderRefunds.squareRefundId)));
      return byKey as WebhookLedgerRow;
    }
  }

  try {
    const inserted = await db()
      .insert(orderRefunds)
      .values({
        orderId: order.id,
        squareRefundId: event.refundId,
        origin: "external",
        amountCents: Math.max(1, event.amountCents),
        currency: event.currency,
        status: "pending",
      })
      .onConflictDoNothing()
      .returning({ id: orderRefunds.id });
    if (inserted.length) {
      return { id: inserted[0]!.id, status: "pending", amountCents: Math.max(1, event.amountCents) };
    }
    const [replayed] = await db()
      .select(select)
      .from(orderRefunds)
      .where(eq(orderRefunds.squareRefundId, event.refundId))
      .limit(1);
    return (replayed as WebhookLedgerRow) ?? null;
  } catch (cause) {
    if (isUniqueViolation(cause)) return null;
    throw cause;
  }
}

/** Guarded pending→completed settle by row id; false means it was already settled. */
export async function settleLedgerRowWithin(
  tx: LedgerExecutor,
  rowId: string,
  squareRefundId: string,
  completedAt: Date,
): Promise<boolean> {
  const rows = await tx
    .update(orderRefunds)
    .set({ status: "completed", squareRefundId, error: null, completedAt, updatedAt: completedAt })
    .where(and(eq(orderRefunds.id, rowId), eq(orderRefunds.status, "pending")))
    .returning({ id: orderRefunds.id });
  return rows.length > 0;
}

/** Best-effort row patch used by webhook failure/pending paths. */
export async function markLedgerRowById(
  rowId: string,
  patch: { squareRefundId?: string; status?: "pending" | "failed"; error?: string | null },
): Promise<void> {
  try {
    await db()
      .update(orderRefunds)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(orderRefunds.id, rowId));
  } catch (cause) {
    reportError("refunds", "could not sync ledger row", cause, { rowId });
  }
}

export type StaffRefundResult =
  | { ok: true; refundedTotalCents: number; remainingCents: number; notice?: string }
  | { ok: false; reason: string };

/**
 * Refund money on a COMPLETED order — partial or full — without touching its
 * status. "Customer collected the tray, it was wrong, refund them" no longer
 * requires the Square Dashboard.
 */
export async function refundCompletedOrder(input: {
  orderId: string;
  amountCents: number;
  reason: string;
  staffInitials: string;
  staffPin?: string;
}): Promise<StaffRefundResult> {
  const roster = await validateInitials(input.staffInitials);
  if (!roster.ok) return { ok: false, reason: roster.message };
  const initials = input.staffInitials.trim().toUpperCase();
  if (await rosterRequiresPin(initials)) {
    if (!input.staffPin) return { ok: false, reason: "Enter your 4-digit PIN to refund." };
    if (!(await verifyStaffPin(initials, input.staffPin))) {
      return { ok: false, reason: "That PIN doesn't match. Refund not issued." };
    }
  }

  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: "A short reason is required for every refund." };

  const [order] = await db().select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
  if (!order) return { ok: false, reason: "Order not found." };
  if (order.status !== "completed") {
    return { ok: false, reason: "Only completed orders can be refunded here. Cancel an active order instead — that refunds it in full." };
  }
  if (!order.squarePaymentId) {
    return { ok: false, reason: "This order has no Square payment reference; reconcile it in Square." };
  }

  const remaining = remainingRefundableCents(order);
  if (remaining === 0) return { ok: false, reason: "This order is already fully refunded." };
  if (!Number.isInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > remaining) {
    return { ok: false, reason: `Enter an amount between 1¢ and the remaining refundable balance.` };
  }

  const now = new Date();
  const claim = await claimRefund(order, now, {
    amountCents: input.amountCents,
    origin: "staff",
    initiatedBy: initials,
    reason,
  });
  if (!claim.ok) {
    if (claim.kind === "external_pending") {
      return { ok: false, reason: "A refund started outside the app is still reconciling. Finish it in Square first." };
    }
    if (claim.kind === "in_flight") {
      return { ok: false, reason: "Square is still processing an earlier refund on this order. Try again in a few minutes." };
    }
    return { ok: false, reason: "Another refund on this order just started. Refresh and check its state." };
  }

  const replayNotice =
    claim.amountCents !== input.amountCents
      ? `An earlier unfinished refund of a different amount was found and completed instead.`
      : undefined;

  const refund = await refundSquarePayment({
    paymentId: order.squarePaymentId,
    amountCents: claim.amountCents,
    currency: order.currency,
    idempotencyKey: claim.key,
    reason: `Order ${order.orderNumber} refund by ${initials}: ${reason}`.slice(0, 192),
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
          eq(orders.refundStatus, "pending"),
          eq(orders.refundAttemptKey, claim.key),
        ));
      return {
        ok: true,
        refundedTotalCents: order.refundedTotalCents,
        remainingCents: remaining,
        notice: "Square's response is delayed. The order is locked while this exact refund attempt reconciles — do not refund it again.",
      };
    }
    await db()
      .update(orders)
      .set({
        refundStatus: "failed",
        refundError: `${refund.code}: ${refund.message}`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(orders.id, order.id),
        eq(orders.refundStatus, "pending"),
        eq(orders.refundAttemptKey, claim.key),
        isNull(orders.squareRefundId),
      ));
    await markLedgerAttempt(claim.key, { status: "failed", error: `${refund.code}: ${refund.message}` });
    return { ok: false, reason: `Square rejected the refund (${refund.message}). Nothing was refunded.` };
  }

  if (refund.disposition === "failed") {
    await db()
      .update(orders)
      .set({
        squareRefundId: refund.refundId,
        refundStatus: "failed",
        refundError: `Square refund ${refund.status ?? "UNKNOWN"}`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(orders.id, order.id),
        eq(orders.refundStatus, "pending"),
        eq(orders.refundAttemptKey, claim.key),
      ));
    await markLedgerAttempt(claim.key, {
      status: "failed",
      squareRefundId: refund.refundId,
      error: `Square refund ${refund.status ?? "UNKNOWN"}`,
    });
    return { ok: false, reason: `Square reported the refund as ${refund.status?.toLowerCase() ?? "unsuccessful"}. Nothing was refunded.` };
  }

  if (refund.disposition === "pending" || refund.disposition === "unknown") {
    await db()
      .update(orders)
      .set({ squareRefundId: refund.refundId, updatedAt: new Date() })
      .where(and(
        eq(orders.id, order.id),
        eq(orders.refundStatus, "pending"),
        eq(orders.refundAttemptKey, claim.key),
      ));
    await markLedgerAttempt(claim.key, { squareRefundId: refund.refundId });
    return {
      ok: true,
      refundedTotalCents: order.refundedTotalCents,
      remainingCents: remaining,
      notice: "Square accepted the refund and is still processing it. The order stays locked until Square confirms.",
    };
  }

  const completedAt = new Date();
  const newTotal = order.refundedTotalCents + claim.amountCents;
  const fullyRefunded = newTotal >= order.totalCents;

  const settled = await db().transaction(async (tx) => {
    const rows = await tx
      .update(orders)
      .set({
        refundStatus: fullyRefunded ? "completed" : "partial",
        squareRefundId: refund.refundId,
        refundError: null,
        refundAttemptStartedAt: null,
        refundedTotalCents: sql`${orders.refundedTotalCents} + ${claim.amountCents}`,
        updatedAt: completedAt,
      })
      .where(and(
        eq(orders.id, order.id),
        eq(orders.refundStatus, "pending"),
        eq(orders.refundAttemptKey, claim.key),
      ))
      .returning({ id: orders.id });
    if (!rows.length) return null;

    const ledgerId = await settleLedgerCompletedWithin(
      tx, order.id, claim.key, refund.refundId ?? null, claim.amountCents, completedAt,
    );
    if (fullyRefunded) await revokeEarnedPointsWithin(tx, order);
    await recordAuditWithin(tx, {
      actorType: "staff",
      actorInitials: initials,
      action: "order.refunded",
      entityType: "order",
      orderId: order.id,
      metadata: {
        orderNumber: order.orderNumber,
        amountCents: claim.amountCents,
        reason,
        fullyRefunded,
      },
    });
    return ledgerId;
  });

  if (!settled) {
    return { ok: false, reason: "The refund response raced with another update. Refresh to see the order's current state." };
  }

  after(() => notifyOrderRefund(order.id, settled));

  return {
    ok: true,
    refundedTotalCents: newTotal,
    remainingCents: Math.max(0, order.totalCents - newTotal),
    notice: replayNotice,
  };
}

function isUniqueViolation(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: string }).code === "23505"
  );
}
