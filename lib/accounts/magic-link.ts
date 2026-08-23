import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, gt, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { customerAccounts, magicLinkTokens } from "@/lib/db/schema";

export const MAGIC_LINK_TTL_MINUTES = 15;

/**
 * Outstanding (unused, unexpired) links per account. A small cap: enough for a
 * flaky inbox and a retry, low enough that a burst of requests can't fill the
 * table for one victim address. The per-email rate limit is the real throttle;
 * this is the durable backstop it can't provide once its window resets.
 */
const MAX_OUTSTANDING_LINKS = 3;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type IssuedMagicLink = {
  token: string;
  account: { id: string; email: string; name: string };
};

/**
 * Issue a sign-in token for the account behind `email`.
 *
 * Returns null when no account exists OR the account is at its outstanding-link
 * cap — callers must respond identically either way (enumeration safety). Only
 * the plaintext return value ever carries the token; the row stores its hash.
 */
export async function issueMagicLink(email: string, now = new Date()): Promise<IssuedMagicLink | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const [account] = await db()
    .select({ id: customerAccounts.id, email: customerAccounts.email, name: customerAccounts.name })
    .from(customerAccounts)
    .where(eq(customerAccounts.email, normalized))
    .limit(1);
  if (!account) return null;

  const [outstanding] = await db()
    .select({ value: count() })
    .from(magicLinkTokens)
    .where(and(
      eq(magicLinkTokens.customerAccountId, account.id),
      isNull(magicLinkTokens.usedAt),
      gt(magicLinkTokens.expiresAt, now),
    ));
  if ((outstanding?.value ?? 0) >= MAX_OUTSTANDING_LINKS) return null;

  const token = randomBytes(32).toString("base64url");
  await db().insert(magicLinkTokens).values({
    customerAccountId: account.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + MAGIC_LINK_TTL_MINUTES * 60_000),
  });

  return { token, account };
}

/**
 * Redeem a token, exactly once.
 *
 * The single atomic UPDATE is the whole security model: two concurrent
 * requests with the same token race on `used_at IS NULL` and Postgres lets
 * exactly one of them through. Never split this into a select-then-update.
 */
export async function consumeMagicLink(token: string, now = new Date()): Promise<{ accountId: string } | null> {
  if (!token) return null;

  const [row] = await db()
    .update(magicLinkTokens)
    .set({ usedAt: now })
    .where(and(
      eq(magicLinkTokens.tokenHash, hashToken(token)),
      isNull(magicLinkTokens.usedAt),
      gt(magicLinkTokens.expiresAt, now),
    ))
    .returning({ accountId: magicLinkTokens.customerAccountId });

  return row ? { accountId: row.accountId } : null;
}

/**
 * Prune tokens that can never be redeemed again: expired, or used more than a
 * day ago (kept briefly so "the link says used" reports can be checked).
 */
export async function sweepMagicLinkTokens(now = new Date()): Promise<number> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
  const rows = await db()
    .delete(magicLinkTokens)
    .where(or(
      lt(magicLinkTokens.expiresAt, now),
      and(sql`${magicLinkTokens.usedAt} IS NOT NULL`, lt(magicLinkTokens.usedAt, dayAgo)),
    ))
    .returning({ id: magicLinkTokens.id });
  return rows.length;
}
