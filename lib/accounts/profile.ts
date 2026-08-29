import "server-only";

import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { resolvePhone } from "@/lib/accounts/phone-sign-in";
import { db } from "@/lib/db";
import { customerAccounts } from "@/lib/db/schema";
import { normalizePhoneE164 } from "@/lib/phone";

/**
 * The customer's own details: what checkout fills itself in with.
 *
 * Until this module existed an account was write-once — created by claiming a
 * paid order and never editable, because nothing in the codebase ever ran
 * `update(customerAccounts)`. A name typed in a hurry at one checkout followed
 * the customer forever.
 *
 * Two invariants shape everything here:
 *
 *  - `email` is unique and is the identity key. Magic-link sign-in, account
 *    claiming and reward matching all resolve on it, so it can move between
 *    accounts only by being free at the time.
 *  - `phone` is deliberately *not* unique (lib/db/schema.ts) so a household can
 *    share a landline. Creation is therefore allowed only against a number that
 *    resolves to nobody: adding a second account to a shared number would make
 *    both unreachable by phone sign-in, which refuses ambiguity by design.
 */

/** Lifted from the checkout schema so a profile and an order agree on what a name is. */
export const profileFieldsSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name").max(120),
  /* Trimmed and lowercased here so every caller gets the canonical form: the
     email is the identity key, and a stray capital or trailing space would
     otherwise create a second account for the same person. */
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email("Please enter a valid email address")),
  phone: z.string().trim().max(30).transform((value, ctx) => {
    const parsed = normalizePhoneE164(value);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.message });
      return z.NEVER;
    }
    return parsed.e164;
  }),
});

export type ProfileFields = z.infer<typeof profileFieldsSchema>;

export type CustomerProfile = {
  name: string;
  email: string;
  phone: string;
  smsOptIn: boolean;
};

export type ProfileResult =
  | { ok: true; accountId: string; profile: CustomerProfile }
  | { ok: false; message: string };

/** The email is already somebody's identity, so it cannot be taken silently. */
const EMAIL_TAKEN =
  "That email already has an account. Sign in with your email instead, and we'll link it up.";

function toProfile(row: typeof customerAccounts.$inferSelect): CustomerProfile {
  return { name: row.name, email: row.email, phone: row.phone, smsOptIn: row.smsOptIn };
}

export async function getProfile(accountId: string): Promise<CustomerProfile | null> {
  const [row] = await db()
    .select()
    .from(customerAccounts)
    .where(eq(customerAccounts.id, accountId))
    .limit(1);
  return row ? toProfile(row) : null;
}

/**
 * Create an account for a number that has just been verified.
 *
 * `phone` comes from a signed signup token, never from the client, so this is
 * only ever reached by somebody who answered a text at that number.
 */
export async function createPhoneProfile(input: {
  phone: string;
  fields: ProfileFields;
}): Promise<ProfileResult> {
  /* The verified number wins over anything typed into the form. Letting the
     field decide would make the signup token proof of nothing. */
  const resolved = await resolvePhone(input.phone);
  if (resolved.kind === "account") {
    return { ok: false, message: "That number already has an account. Try signing in instead." };
  }
  if (resolved.kind === "ambiguous") {
    return { ok: false, message: "That number can't be used to sign up. Please use email instead." };
  }

  const [created] = await db()
    .insert(customerAccounts)
    .values({ email: input.fields.email, name: input.fields.name, phone: input.phone })
    /* The unique index on email is the real guard: two people completing signup
       with the same address at once both pass the check above. */
    .onConflictDoNothing({ target: customerAccounts.email })
    .returning();

  if (!created) return { ok: false, message: EMAIL_TAKEN };

  return { ok: true, accountId: created.id, profile: toProfile(created) };
}

/** Edit an existing profile. Every field is optional; absent means unchanged. */
export async function updateProfile(
  accountId: string,
  fields: Partial<ProfileFields> & { smsOptIn?: boolean },
): Promise<ProfileResult> {
  const email = fields.email;

  if (email) {
    const [clash] = await db()
      .select({ id: customerAccounts.id })
      .from(customerAccounts)
      .where(and(eq(customerAccounts.email, email), ne(customerAccounts.id, accountId)))
      .limit(1);
    if (clash) return { ok: false, message: EMAIL_TAKEN };
  }

  let updated: typeof customerAccounts.$inferSelect | undefined;
  try {
    [updated] = await db()
      .update(customerAccounts)
      .set({
        ...(fields.name === undefined ? {} : { name: fields.name }),
        ...(email === undefined ? {} : { email }),
        ...(fields.phone === undefined ? {} : { phone: fields.phone }),
        ...(fields.smsOptIn === undefined ? {} : { smsOptIn: fields.smsOptIn }),
        updatedAt: new Date(),
      })
      .where(eq(customerAccounts.id, accountId))
      .returning();
  } catch (cause) {
    /* The read above is advisory — two sessions can both pass it and race for
       the same address. The unique index is what actually decides, and it
       raises rather than returning nothing, so the loser is caught here. */
    if (isUniqueViolation(cause)) return { ok: false, message: EMAIL_TAKEN };
    throw cause;
  }

  // The session outlived the account — deleted, or a retention sweep ran.
  if (!updated) return { ok: false, message: "That account no longer exists." };

  return { ok: true, accountId: updated.id, profile: toProfile(updated) };
}

/** Postgres 23505, whatever driver wrapper it arrives inside. */
function isUniqueViolation(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    (("code" in cause && cause.code === "23505") ||
      ("cause" in cause && isUniqueViolation(cause.cause)))
  );
}
