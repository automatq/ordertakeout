import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { customerAccounts, loyaltyEntries, orders } from "@/lib/db/schema";
import type { LoyaltyEntry } from "@/lib/db/schema";

/** One point per whole currency unit collected; 100 points unlocks $10 off. */
export const REWARD_POINTS = 100;
export const REWARD_DISCOUNT_CENTS = 1_000;

export async function loyaltyBalance(customerAccountId: string): Promise<number> {
  const [row] = await db().select({
    points: sql<number>`coalesce(sum(${loyaltyEntries.points}), 0)`,
  }).from(loyaltyEntries).where(eq(loyaltyEntries.customerAccountId, customerAccountId));
  return Number(row?.points ?? 0);
}

export async function getCurrentCustomerAccount() {
  const { currentAccountId } = await import("./session");
  const accountId = await currentAccountId();
  if (!accountId) return null;
  const [account] = await db().select().from(customerAccounts).where(eq(customerAccounts.id, accountId)).limit(1);
  if (!account) return null;
  return { ...account, points: await loyaltyBalance(account.id) };
}

/** How many ledger rows a customer is shown before it stops being a summary. */
const LEDGER_LIMIT = 10;

export type LoyaltyLedgerEntry = Pick<LoyaltyEntry, "id" | "kind" | "points" | "createdAt"> & {
  /** The order the points moved on — the only handle a customer can recognise. */
  orderNumber: string;
};

/**
 * Recent points activity, newest first.
 *
 * Joined to orders rather than exposing the internal order id: a balance that
 * changed with no way to see which purchase moved it reads as a mistake, and
 * "order H-1042" is the receipt in the customer's hand.
 *
 * Shared by the web account page and the app's rewards endpoint so the two
 * cannot drift into showing the same customer different histories.
 */
export async function loyaltyLedger(
  customerAccountId: string,
  limit = LEDGER_LIMIT,
): Promise<LoyaltyLedgerEntry[]> {
  return db()
    .select({
      id: loyaltyEntries.id,
      kind: loyaltyEntries.kind,
      points: loyaltyEntries.points,
      createdAt: loyaltyEntries.createdAt,
      orderNumber: orders.orderNumber,
    })
    .from(loyaltyEntries)
    .innerJoin(orders, eq(loyaltyEntries.orderId, orders.id))
    .where(eq(loyaltyEntries.customerAccountId, customerAccountId))
    .orderBy(desc(loyaltyEntries.createdAt))
    .limit(limit);
}
