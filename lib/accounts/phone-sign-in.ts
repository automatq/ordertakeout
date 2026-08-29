import "server-only";

import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, count, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";

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
 * Salted per subject so the same six digits issued to two people produce
 * different hashes, and a stolen table can't be reversed with one small
 * rainbow table of 000000-999999.
 *
 * The subject is the account for a sign-in code and the number itself for a
 * sign-up code, which has no account yet. Existing rows keep the account salt,
 * so codes outstanding across the deploy stay redeemable.
 */
function hashCode(subject: string, code: string): string {
  return createHash("sha256").update(`${subject}:${code}`).digest("hex");
}

/** What a code was issued against: an existing account, or a new number. */
function subjectOf(accountId: string | null, e164: string): string {
  return accountId ?? `phone:${e164}`;
}

function generateCode(): string {
  return String(randomInt(0, 10 ** PHONE_CODE_LENGTH)).padStart(PHONE_CODE_LENGTH, "0");
}

export type PhoneResolution =
  | { kind: "none" }
  | { kind: "account"; account: { id: string; name: string; phone: string } }
  | { kind: "ambiguous" };

/**
 * What a phone number resolves to.
 *
 * `customer_accounts.phone` is deliberately not unique: a household can
 * register two accounts against one landline. Guessing which member is holding
 * the phone would hand one person another's order history, so an ambiguous
 * number is refused and those customers use email sign-in, which is always
 * offered alongside.
 *
 * The three cases are distinguished — rather than collapsed to a single null —
 * because sign-up needs to tell "nobody has this number" apart from "two people
 * do". Only the first may create an account; creating one on an already
 * ambiguous number would add a third that equally cannot sign in.
 */
export async function resolvePhone(phone: string): Promise<PhoneResolution> {
  const parsed = normalizePhoneE164(phone);
  if (!parsed.ok) return { kind: "none" };

  const rows = await db()
    .select({ id: customerAccounts.id, name: customerAccounts.name, phone: customerAccounts.phone })
    .from(customerAccounts)
    .where(eq(customerAccounts.phone, parsed.e164))
    .limit(2);

  if (rows.length === 0) return { kind: "none" };
  if (rows.length > 1) return { kind: "ambiguous" };
  return { kind: "account", account: rows[0]! };
}

export type IssuedPhoneCode = {
  code: string;
  /** The number the code was texted to, in E.164. */
  phone: string;
  /** Null when the number has no account and this code opens sign-up instead. */
  account: { id: string; name: string; phone: string } | null;
};

/**
 * Issue a code for `phone`, whether or not it belongs to an account.
 *
 * A number with no account gets a real code that redeems into profile creation
 * rather than a session. That is what makes CODE_SENT_MESSAGE true for a new
 * customer: it used to promise a text that was never sent.
 *
 * Still null when the number is ambiguous or the subject is at its
 * outstanding-code cap. Callers must respond identically in every case — a
 * different answer turns this into a "does this number shop here" oracle.
 * Only the return value ever carries the plaintext code.
 */
export async function issuePhoneSignInCode(
  phone: string,
  now = new Date(),
): Promise<IssuedPhoneCode | null> {
  const parsed = normalizePhoneE164(phone);
  if (!parsed.ok) return null;

  const resolved = await resolvePhone(parsed.e164);
  /* Ambiguous numbers are refused here exactly as before. Issuing to one of two
     household accounts would guess, and issuing a sign-up code would offer a
     third account on a number that already cannot sign in. */
  if (resolved.kind === "ambiguous") return null;
  const account = resolved.kind === "account" ? resolved.account : null;

  const [outstanding] = await db()
    .select({ value: count() })
    .from(phoneSignInCodes)
    .where(and(
      eq(phoneSignInCodes.phone, parsed.e164),
      isNull(phoneSignInCodes.consumedAt),
      gt(phoneSignInCodes.expiresAt, now),
    ));
  if ((outstanding?.value ?? 0) >= MAX_OUTSTANDING_CODES) return null;

  const code = generateCode();
  await db().insert(phoneSignInCodes).values({
    customerAccountId: account?.id ?? null,
    phone: parsed.e164,
    codeHash: hashCode(subjectOf(account?.id ?? null, parsed.e164), code),
    expiresAt: new Date(now.getTime() + PHONE_CODE_TTL_MINUTES * 60_000),
  });

  return { code, phone: parsed.e164, account };
}

export type ConsumedPhoneCode =
  /** The number has an account: the caller opens a session. */
  | { kind: "account"; accountId: string }
  /** The number is verified but unknown: the caller offers profile creation. */
  | { kind: "new"; phone: string };

/**
 * Redeem a code, exactly once.
 *
 * The single UPDATE is the concurrency guarantee, as with magic links: two
 * requests carrying the same code race on `consumed_at IS NULL` and Postgres
 * lets one through. A miss burns an attempt on every live code for that
 * number, so requesting three codes buys an attacker three codes, not three
 * times the guesses.
 */
export async function consumePhoneSignInCode(
  phone: string,
  code: string,
  now = new Date(),
): Promise<ConsumedPhoneCode | null> {
  const trimmed = code.trim();
  if (!/^\d+$/.test(trimmed) || trimmed.length !== PHONE_CODE_LENGTH) return null;

  const parsed = normalizePhoneE164(phone);
  if (!parsed.ok) return null;

  const resolved = await resolvePhone(parsed.e164);
  if (resolved.kind === "ambiguous") return null;
  const accountId = resolved.kind === "account" ? resolved.account.id : null;

  /* Both salts, because the two can disagree across the life of one code: a
     number with no account is issued a code salted against the number, and the
     account may be claimed from the confirmation page before that code is
     redeemed. Matching only today's salt would fail a code the customer is
     holding and reading correctly. */
  const candidates = [hashCode(subjectOf(null, parsed.e164), trimmed)];
  if (accountId) candidates.push(hashCode(accountId, trimmed));

  const [row] = await db()
    .update(phoneSignInCodes)
    .set({ consumedAt: now })
    .where(and(
      eq(phoneSignInCodes.phone, parsed.e164),
      inArray(phoneSignInCodes.codeHash, candidates),
      isNull(phoneSignInCodes.consumedAt),
      gt(phoneSignInCodes.expiresAt, now),
      lt(phoneSignInCodes.attempts, MAX_CODE_ATTEMPTS),
    ))
    .returning({ accountId: phoneSignInCodes.customerAccountId });

  if (row) {
    /* Decided by what the number resolves to now, not by what it resolved to
       when the code was issued. Somebody who received the text controls the
       handset, so if an account has since been claimed on it, that is the
       account to open rather than a dead end offering a duplicate profile. */
    const owner = row.accountId ?? accountId;
    return owner
      ? { kind: "account", accountId: owner }
      : { kind: "new", phone: parsed.e164 };
  }

  await db()
    .update(phoneSignInCodes)
    .set({ attempts: sql`${phoneSignInCodes.attempts} + 1` })
    .where(and(
      eq(phoneSignInCodes.phone, parsed.e164),
      isNull(phoneSignInCodes.consumedAt),
      gt(phoneSignInCodes.expiresAt, now),
    ));

  return null;
}

/**
 * Constant-time compare, exported for tests that assert the hashing contract.
 * Not used by the consume path, which compares inside Postgres.
 *
 * `subject` is an account id for a sign-in code, or `phone:<e164>` for a
 * sign-up one — see subjectOf.
 */
export function codeMatchesHash(subject: string, code: string, hash: string): boolean {
  const expected = Buffer.from(hashCode(subject, code));
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
