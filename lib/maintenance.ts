import "server-only";

import { and, inArray, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { notificationLog, orders, rateLimits, webhookEvents } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { retryFailedNotifications } from "@/lib/notifications/dispatch";
import { sweepExpiredHolds } from "@/lib/scheduling/queries";
import { retrySquareOrderSync } from "@/lib/orders/transitions";

export async function runMaintenance() {
  const [holds, retries, squareRetries, operationalRows, anonymizedOrders] = await Promise.all([
    sweepExpiredHolds(),
    retryFailedNotifications(),
    retrySquareSyncFailures(),
    pruneOperationalData(),
    anonymizeExpiredCustomerData(),
  ]);
  return { holds, retries, squareRetries, operationalRows, anonymizedOrders };
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
