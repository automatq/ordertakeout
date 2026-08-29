"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  createPhoneProfile,
  profileFieldsSchema,
  updateProfile as updateProfileRecord,
  type CustomerProfile,
} from "@/lib/accounts/profile";
import { clearAccountSession, currentAccountId, setAccountSession } from "@/lib/accounts/session";
import { clearSignupSession, currentSignupPhone } from "@/lib/accounts/signup-token";
import { db } from "@/lib/db";
import { customerAccounts, orders } from "@/lib/db/schema";
import { verifyOrderAccessToken } from "@/lib/orders/access";
import { getOrderByNumber } from "@/lib/orders/lookup";

const claimSchema = z.object({
  orderNumber: z.string().min(1).max(64),
  accessToken: z.string().min(20).max(128),
});

export type ClaimAccountResult = { ok: true } | { ok: false; message: string; needsSignIn?: boolean };

/** A signed confirmation is the proof needed to opt a guest into an account. */
export async function claimCustomerAccount(input: unknown): Promise<ClaimAccountResult> {
  const parsed = claimSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That confirmation link is no longer valid." };
  const order = await getOrderByNumber(parsed.data.orderNumber);
  if (!order || !verifyOrderAccessToken(order.id, order.orderNumber, parsed.data.accessToken)) {
    return { ok: false, message: "That confirmation link is no longer valid." };
  }

  const email = order.customerEmail.trim().toLowerCase();
  const claim = await db().transaction(async (tx) => {
    const [existing] = await tx.select().from(customerAccounts).where(eq(customerAccounts.email, email)).limit(1);
    // A tracking link proves access to this *order*, not ownership of every
    // account that happens to use the same address. In particular, receipts
    // are routinely forwarded. Never turn that bearer link into a session for
    // an already-established account; its owner must complete normal sign-in.
    if (existing) return { kind: "existing" as const };
    const [created] = await tx.insert(customerAccounts).values({
      email,
      name: order.customerName,
      phone: order.customerPhone,
    }).onConflictDoNothing().returning();
    // Losing the unique-index race also means another account already exists.
    // Do not resolve and sign into it with this order's tracking credential.
    if (!created) return { kind: "existing" as const };
    await tx.update(orders).set({ customerAccountId: created.id, updatedAt: new Date() })
      .where(and(eq(orders.id, order.id), isNull(orders.customerAccountId)));
    return { kind: "created" as const, account: created };
  });

  if (claim.kind === "existing") {
    return {
      ok: false,
      needsSignIn: true,
      message: "An account already uses this email. Sign in to protect its orders and rewards.",
    };
  }

  await setAccountSession(claim.account.id);
  revalidatePath("/account");
  return { ok: true };
}

export async function signOutCustomerAccount() {
  await clearAccountSession();
  revalidatePath("/");
}

export type ProfileActionResult =
  | { ok: true; profile: CustomerProfile }
  | { ok: false; message: string };

/**
 * Finish sign-up for a number that has just answered a texted code.
 *
 * The number comes from the signed cookie set at verification, never from the
 * form — the form's phone field is only there so the customer can see what they
 * are registering.
 */
export async function createProfileFromPhone(input: unknown): Promise<ProfileActionResult> {
  const phone = await currentSignupPhone();
  if (!phone) {
    return { ok: false, message: "That took too long. Request a new code and try again." };
  }

  const fields = profileFieldsSchema.safeParse(input);
  if (!fields.success) {
    return { ok: false, message: fields.error.issues[0]?.message ?? "Please check the details." };
  }

  const created = await createPhoneProfile({ phone, fields: fields.data });
  if (!created.ok) return created;

  await setAccountSession(created.accountId);
  await clearSignupSession();
  revalidatePath("/account");
  return { ok: true, profile: created.profile };
}

const editProfileSchema = profileFieldsSchema.partial().extend({
  smsOptIn: z.boolean().optional(),
});

export async function updateProfile(input: unknown): Promise<ProfileActionResult> {
  const accountId = await currentAccountId();
  if (!accountId) return { ok: false, message: "Please sign in again." };

  const parsed = editProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the details." };
  }

  const result = await updateProfileRecord(accountId, parsed.data);
  if (!result.ok) return result;

  revalidatePath("/account");
  revalidatePath("/checkout");
  return { ok: true, profile: result.profile };
}
