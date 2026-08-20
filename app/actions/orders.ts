"use server";

import { z } from "zod";

import { getOrderByNumber } from "@/lib/orders/lookup";
import { consumeRateLimit, requestFingerprint } from "@/lib/security/rate-limit";
import { createOrderAccessToken, verifyOrderAccessToken } from "@/lib/orders/access";
import { customerCancellationEligibility } from "@/lib/orders/cancellation";
import { advanceOrder } from "@/lib/orders/transitions";

/**
 * Customer-facing order lookup.
 *
 * The confirmation URL used to be the only route back to an order — close the
 * tab and it was gone, with nothing in the site chrome offering a way back.
 *
 * Order numbers are random rather than sequential, so holding one is already
 * treated as proof enough to view a confirmation. A general lookup form is a
 * different exposure: it invites guessing. So this pairs the number with the
 * email on the order, exactly as lib/orders/lookup.ts asks any such page to.
 */

const lookupSchema = z.object({
  orderNumber: z.string().trim().min(1, "Enter your order number."),
  email: z.email("Enter the email address you ordered with."),
});

export type LookupResult =
  | { ok: true; orderNumber: string; accessToken: string }
  | { ok: false; message: string };

export async function findOrder(
  _previous: LookupResult | null,
  formData: FormData,
): Promise<LookupResult> {
  const limit = await consumeRateLimit("order-lookup", await requestFingerprint(), {
    attempts: 10,
    windowMs: 10 * 60_000,
  });
  if (!limit.allowed) {
    return { ok: false, message: "Too many lookup attempts. Wait a few minutes and try again." };
  }
  const parsed = lookupSchema.safeParse({
    orderNumber: formData.get("orderNumber"),
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const order = await getOrderByNumber(parsed.data.orderNumber);

  /**
   * One message for "no such order" and for "wrong email", deliberately. Two
   * different messages would turn this form into an oracle for which order
   * numbers exist.
   */
  const matches =
    order && order.customerEmail.toLowerCase() === parsed.data.email.trim().toLowerCase();

  if (!matches) {
    return {
      ok: false,
      message:
        "We couldn't find an order with that number and email address. Check both and try again.",
    };
  }

  return {
    ok: true,
    orderNumber: order.orderNumber,
    accessToken: createOrderAccessToken(order.id, order.orderNumber),
  };
}

const cancelSchema = z.object({ orderNumber: z.string().min(1), accessToken: z.string().min(20) });

export async function cancelCustomerOrder(input: unknown): Promise<{ ok: true } | { ok: false; reason: string }> {
  const limit = await consumeRateLimit("customer-cancel", await requestFingerprint(), {
    attempts: 5,
    windowMs: 15 * 60_000,
  });
  if (!limit.allowed) return { ok: false, reason: "Too many attempts. Wait a few minutes and try again." };

  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "That cancellation link is invalid." };
  const order = await getOrderByNumber(parsed.data.orderNumber);
  if (!order || !verifyOrderAccessToken(order.id, order.orderNumber, parsed.data.accessToken)) {
    return { ok: false, reason: "That cancellation link is invalid." };
  }
  const eligibility = await customerCancellationEligibility(order);
  if (!eligibility.allowed) return { ok: false, reason: eligibility.reason };
  const result = await advanceOrder(order.id, "canceled");
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}
