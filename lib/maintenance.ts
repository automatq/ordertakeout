import "server-only";

import { and, inArray, lt, sql } from "drizzle-orm";

import { sweepMagicLinkTokens } from "@/lib/accounts/magic-link";
import { db } from "@/lib/db";
import { notificationLog, orders, rateLimits, webhookEvents } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { sweepExpiredInventoryHolds } from "@/lib/inventory/reservations";
import { retryFailedNotifications } from "@/lib/notifications/dispatch";
import { recoverStalePaymentAttempts } from "@/lib/orders/create";
import { sweepExpiredHolds } from "@/lib/scheduling/queries";
import { retrySquareOrderSync } from "@/lib/orders/transitions";

/**
 * The minutes-scale jobs: notification retries (next_attempt_at is +5 min),
 * stale payment recovery, Square-sync retries, and hold sweeps. Capacity is
 * never blocked by an expired hold — both read paths filter expires_at — so
 * the sweeps here are housekeeping; the retries are the reason this runs
 * often. Vercel Hobby only allows daily crons, so a GitHub Actions schedule
 * calls this every few minutes via /api/cron/maintenance?scope=fast.
 */
export async function runFastMaintenance() {
  const [holds, inventoryHolds, retries, squareRetries, paymentAttempts] = await Promise.all([
    sweepExpiredHolds(),
    sweepExpiredInventoryHolds(),
    retryFailedNotifications(),
    retrySquareSyncFailures(),
    recoverStalePaymentAttempts(),
  ]);
  return {
    holds,
    inventoryHolds,
    retries,
    squareRetries,
    paymentAttempts,
  };
}

/** The full daily run: everything in the fast pass plus pruning and PII retention. */
export async function runMaintenance() {
  const [fast, operationalRows, anonymizedOrders, magicLinkRows] = await Promise.all([
    runFastMaintenance(),
    pruneOperationalData(),
    anonymizeExpiredCustomerData(),
    sweepMagicLinkTokens(),
  ]);
  return {
    ...fast,
    operationalRows,
    anonymizedOrders,
    magicLinkRows,
  };
}

async function retrySquareSyncFailures(): Promise<number> {
  const rows = await db()
    .select({ id: orders.id })
    .from(orders)
    .where(sql`${orders.squareSyncError} IS NOT NULL`)
    .limit(20);
  let completed = 0;
  for (const row of rows) {
    if (await retrySquareOrderSync(row.id)) completed += 1;
  }
  return completed;
}

async function pruneOperationalData(): Promise<number> {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60_000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60_000);
  const [limits, webhooks, notifications] = await db().transaction(async (tx) => {
    const limits = await tx.delete(rateLimits).where(lt(rateLimits.updatedAt, twoDaysAgo)).returning({ id: rateLimits.id });
    const webhooks = await tx.delete(webhookEvents).where(lt(webhookEvents.receivedAt, thirtyDaysAgo)).returning({ id: webhookEvents.squareEventId });
    const notifications = await tx.delete(notificationLog).where(and(
      sql`${notificationLog.status} = 'sent'`,
      lt(notificationLog.createdAt, ninetyDaysAgo),
    )).returning({ id: notificationLog.id });
    return [limits, webhooks, notifications] as const;
  });
  return limits.length + webhooks.length + notifications.length;
}

async function anonymizeExpiredCustomerData(): Promise<number> {
  const days = serverEnv().CUSTOMER_DATA_RETENTION_DAYS;
  if (!days) return 0;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000);
  const rows = await db()
    .update(orders)
    .set({
      customerName: "Deleted customer",
      customerEmail: "deleted@invalid.example",
      customerPhone: "Deleted",
      customerNote: null,
      staffNote: null,
      updatedAt: new Date(),
    })
    .where(and(
      inArray(orders.status, ["completed", "canceled"]),
      lt(orders.updatedAt, cutoff),
      sql`${orders.customerEmail} <> 'deleted@invalid.example'`,
    ))
    .returning({ id: orders.id });
  return rows.length;
}
