"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { clearAccountSession, setAccountSession } from "@/lib/accounts/session";
import { db } from "@/lib/db";
import { customerAccounts, orders } from "@/lib/db/schema";
import { verifyOrderAccessToken } from "@/lib/orders/access";
import { getOrderByNumber } from "@/lib/orders/lookup";

const claimSchema = z.object({
  orderNumber: z.string().min(1).max(64),
  accessToken: z.string().min(20).max(128),
});

export type ClaimAccountResult = { ok: true } | { ok: false; message: string };

/** A signed confirmation is the proof needed to opt a guest into an account. */
export async function claimCustomerAccount(input: unknown): Promise<ClaimAccountResult> {
  const parsed = claimSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That confirmation link is no longer valid." };
  const order = await getOrderByNumber(parsed.data.orderNumber);
  if (!order || !verifyOrderAccessToken(order.id, order.orderNumber, parsed.data.accessToken)) {
    return { ok: false, message: "That confirmation link is no longer valid." };
  }

  const email = order.customerEmail.trim().toLowerCase();
  const account = await db().transaction(async (tx) => {
    const [existing] = await tx.select().from(customerAccounts).where(eq(customerAccounts.email, email)).limit(1);
    const [created] = existing ? [] : await tx.insert(customerAccounts).values({
      email,
      name: order.customerName,
      phone: order.customerPhone,
    }).onConflictDoNothing().returning();
    // Another signed confirmation may have claimed the same email in the
    // moment between our read and insert; resolve it rather than treating that
    // normal race as a failed account creation.
    const result = existing ?? created ?? (await tx.select().from(customerAccounts)
      .where(eq(customerAccounts.email, email)).limit(1))[0];
    if (!result) throw new Error("Could not create customer account");
    await tx.update(orders).set({ customerAccountId: result.id, updatedAt: new Date() })
      .where(and(eq(orders.id, order.id), isNull(orders.customerAccountId)));
    return result;
  });

  await setAccountSession(account.id);
  revalidatePath("/account");
  return { ok: true };
}

export async function signOutCustomerAccount() {
  await clearAccountSession();
  revalidatePath("/");
}
