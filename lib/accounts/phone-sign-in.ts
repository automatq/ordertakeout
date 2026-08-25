import "server-only";

import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, count, eq, gt, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { customerAccounts, phoneSignInCodes } from "@/lib/db/schema";
import { normalizePhoneE164 } from "@/lib/phone";

export const PHONE_CODE_TTL_MINUTES = 10;
export const PHONE_CODE_LENGTH = 6;

/**
 * Wrong guesses before the code is dead.
 *
 * Six digits is a million possibilities — an attacker who can keep guessing
 * gets in. The rate limiter throttles request volume; this bounds guesses
 * against a code that has already been issued, which the rate limiter cannot.
 */
export const MAX_CODE_ATTEMPTS = 5;

/** Live codes per account, so a burst of requests can't fill the table for one number. */
const MAX_OUTSTANDING_CODES = 3;

/**
 * Salted per account so the same six digits issued to two people produce
 * different hashes, and a stolen table can't be reversed with one small
 * rainbow table of 000000-999999.
 */
function hashCode(accountId: string, code: string): string {
  return createHash("sha256").update(`${accountId}:${code}`).digest("hex");
}

function generateCode(): string {
  return String(randomInt(0, 10 ** PHONE_CODE_LENGTH)).padStart(PHONE_CODE_LENGTH, "0");
}

/**
 * Resolve the single account for a phone number.
 *
 * Returns null when the number matches none — and *also* when it matches more
 * than one. `customer_accounts.phone` is deliberately not unique: a household
 * can register two accounts against one landline. Guessing which member is
 * holding the phone would hand one person another's order history, so an
 * ambiguous number is refused and those customers use email sign-in, which is
 * always offered alongside.
 */
async function findAccountByPhone(phone: string) {
  const parsed = normalizePhoneE164(phone);
  if (!parsed.ok) return null;

  const rows = await db()
    .select({ id: customerAccounts.id, name: customerAccounts.name, phone: customerAccounts.phone })
    .from(customerAccounts)
    .where(eq(customerAccounts.phone, parsed.e164))
    .limit(2);

  return rows.length === 1 ? rows[0]! : null;
}

export type IssuedPhoneCode = {
  code: string;
  account: { id: string; name: string; phone: string };
};

/**
 * Issue a sign-in code for the account behind `phone`.
 *
 * Null when there is no account, the number is ambiguous, or the account is at
 * its outstanding-code cap. Callers must respond identically in every case —
 * a different answer turns this into a "does this number shop here" oracle.
 * Only the return value ever carries the plaintext code.
 */
export async function issuePhoneSignInCode(
  phone: string,
  now = new Date(),
): Promise<IssuedPhoneCode | null> {
  const account = await findAccountByPhone(phone);
  if (!account) return null;

  const [outstanding] = await db()
    .select({ value: count() })
    .from(phoneSignInCodes)
    .where(and(
      eq(phoneSignInCodes.customerAccountId, account.id),
      isNull(phoneSignInCodes.consumedAt),
      gt(phoneSignInCodes.expiresAt, now),
    ));
  if ((outstanding?.value ?? 0) >= MAX_OUTSTANDING_CODES) return null;

  const code = generateCode();
  await db().insert(phoneSignInCodes).values({
    customerAccountId: account.id,
    codeHash: hashCode(account.id, code),
    expiresAt: new Date(now.getTime() + PHONE_CODE_TTL_MINUTES * 60_000),
  });

  return { code, account };
}

/**
 * Redeem a code, exactly once.
 *
 * The single UPDATE is the concurrency guarantee, as with magic links: two
 * requests carrying the same code race on `consumed_at IS NULL` and Postgres
 * lets one through. A miss burns an attempt on every live code for that
 * account, so requesting three codes buys an attacker three codes, not three
 * times the guesses.
 */
export async function consumePhoneSignInCode(
  phone: string,
  code: string,
  now = new Date(),
): Promise<{ accountId: string } | null> {
  const trimmed = code.trim();
  if (!/^\d+$/.test(trimmed) || trimmed.length !== PHONE_CODE_LENGTH) return null;

  const account = await findAccountByPhone(phone);
  if (!account) return null;

  const [row] = await db()
    .update(phoneSignInCodes)
    .set({ consumedAt: now })
    .where(and(
      eq(phoneSignInCodes.customerAccountId, account.id),
      eq(phoneSignInCodes.codeHash, hashCode(account.id, trimmed)),
      isNull(phoneSignInCodes.consumedAt),
      gt(phoneSignInCodes.expiresAt, now),
      lt(phoneSignInCodes.attempts, MAX_CODE_ATTEMPTS),
    ))
    .returning({ accountId: phoneSignInCodes.customerAccountId });

  if (row) return { accountId: row.accountId };

  await db()
    .update(phoneSignInCodes)
    .set({ attempts: sql`${phoneSignInCodes.attempts} + 1` })
    .where(and(
      eq(phoneSignInCodes.customerAccountId, account.id),
      isNull(phoneSignInCodes.consumedAt),
      gt(phoneSignInCodes.expiresAt, now),
    ));

  return null;
}

/**
 * Constant-time compare, exported for tests that assert the hashing contract.
 * Not used by the consume path, which compares inside Postgres.
 */
export function codeMatchesHash(accountId: string, code: string, hash: string): boolean {
  const expected = Buffer.from(hashCode(accountId, code));
  const received = Buffer.from(hash);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Prune codes that can never be redeemed again. Mirrors the magic-link sweep. */
export async function sweepPhoneSignInCodes(now = new Date()): Promise<number> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
  const rows = await db()
    .delete(phoneSignInCodes)
    .where(or(
      lt(phoneSignInCodes.expiresAt, now),
      and(sql`${phoneSignInCodes.consumedAt} IS NOT NULL`, lt(phoneSignInCodes.consumedAt, dayAgo)),
    ))
    .returning({ id: phoneSignInCodes.id });
  return rows.length;
}
