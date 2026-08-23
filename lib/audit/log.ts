import "server-only";

import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { reportError } from "@/lib/monitoring/report";

/**
 * Append-only operator audit trail.
 *
 * `recordAudit` never throws — an unloggable action must still succeed, and a
 * failed audit write is itself reported. Money-critical writers (refund
 * completion) use `recordAuditWithin` instead so the audit row commits or rolls
 * back atomically with the money state.
 *
 * `metadata` must never contain customer PII: the retention anonymizer does not
 * touch this table, so anything written here outlives the order's customer
 * fields. Amounts, statuses, reasons, and key names are fine; names, emails,
 * and phone numbers are not.
 */

export type AuditActorType = "staff" | "system:webhook" | "system:cron" | "customer";

export interface AuditEntry {
  actorType: AuditActorType;
  /** Roster initials for staff actors; null for system/customer. */
  actorInitials?: string | null;
  /** Dotted verb slug, e.g. "order.status_changed", "order.refunded". */
  action: string;
  entityType: string;
  entityId?: string | null;
  orderId?: string | null;
  metadata?: Record<string, unknown> | null;
}

type Executor = Pick<ReturnType<typeof db>, "insert">;

export async function recordAuditWithin(executor: Executor, entry: AuditEntry): Promise<void> {
  await executor.insert(auditLog).values({
    actorType: entry.actorType,
    actorInitials: entry.actorInitials ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    orderId: entry.orderId ?? null,
    metadata: entry.metadata ?? null,
  });
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await recordAuditWithin(db(), entry);
  } catch (cause) {
    reportError("audit", "could not record audit entry", cause, { action: entry.action });
  }
}

export interface AuditQuery {
  action?: string;
  actorInitials?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export async function listAuditLog(query: AuditQuery = {}) {
  const conditions: SQL[] = [];
  if (query.action) conditions.push(eq(auditLog.action, query.action));
  if (query.actorInitials) {
    conditions.push(sql`upper(${auditLog.actorInitials}) = ${query.actorInitials.toUpperCase()}`);
  }
  if (query.from) conditions.push(gte(auditLog.createdAt, query.from));
  if (query.to) conditions.push(lte(auditLog.createdAt, query.to));

  return db()
    .select()
    .from(auditLog)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(Math.min(query.limit ?? 50, 200))
    .offset(query.offset ?? 0);
}
