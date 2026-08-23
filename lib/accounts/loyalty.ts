import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { customerAccounts, loyaltyEntries } from "@/lib/db/schema";

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
