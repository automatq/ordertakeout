"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  SESSION_COOKIE,
  createSessionToken,
  safeEqual,
  sessionMaxAgeSeconds,
} from "@/lib/auth/session";
import { requireStaffSession } from "@/lib/auth/guard";
import { getDashboardData, type DashboardData } from "@/lib/orders/dashboard";
import { advanceOrder, type TransitionResult } from "@/lib/orders/transitions";
import {
  previewPickupVerification,
  verifyPickup,
  type PickupVerificationPreview,
  type PickupVerificationResult,
} from "@/lib/orders/pickup-verification";
import { serverEnv } from "@/lib/env";
import { consumeRateLimit, requestFingerprint } from "@/lib/security/rate-limit";

/** Staff dashboard actions. Every one of these re-checks the session. */

export async function signIn(
  _previous: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  const password = String(formData.get("password") ?? "");
  const limit = await consumeRateLimit("staff-sign-in", await requestFingerprint(), {
    attempts: 5,
    windowMs: 15 * 60_000,
  });
  if (!limit.allowed) {
    return { error: "Too many sign-in attempts. Wait a few minutes and try again." };
  }

  if (!safeEqual(password, serverEnv().STAFF_DASHBOARD_PASSWORD)) {
    // Deliberately vague, and no hint about length or format.
    return { error: "That password isn't right." };
  }

  const token = await createSessionToken(serverEnv().STAFF_DASHBOARD_PASSWORD);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionMaxAgeSeconds(),
  });

  redirect("/staff");
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/staff/login");
}

/** Polled by the order screen. Filtering server-side keeps a busy two-location
 * shop from shipping every branch's orders to every tablet on every poll. */
export async function refreshDashboard(locationId?: unknown): Promise<DashboardData> {
  await requireStaffSession();
  const parsed = z.string().min(1).max(64).optional().safeParse(locationId ?? undefined);
  return getDashboardData(7, parsed.success ? parsed.data : undefined);
}

const transitionSchema = z.object({
  orderId: z.uuid(),
  status: z.enum(["preparing", "ready", "canceled"]),
});

export async function changeOrderStatus(input: unknown): Promise<TransitionResult> {
  await requireStaffSession();

  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "That status change isn't valid." };
  }

  return advanceOrder(parsed.data.orderId, parsed.data.status);
}

const pickupVerificationSchema = z.object({
  method: z.enum(["qr", "manual"]),
  value: z.string().trim().min(1).max(500),
});

const confirmPickupSchema = pickupVerificationSchema.extend({
  staffInitials: z.string().trim().min(1).max(12),
});

/** Look up a ready order for a staff member before the final collection check. */
export async function previewPickup(input: unknown): Promise<PickupVerificationPreview | { ok: false; reason: string }> {
  await requireStaffSession();
  const parsed = pickupVerificationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "Scan a pickup pass or enter an order number." };
  return previewPickupVerification(parsed.data);
}

/** Confirm collection after the staff member has checked the customer's name. */
export async function confirmPickup(input: unknown): Promise<PickupVerificationResult> {
  await requireStaffSession();
  const parsed = confirmPickupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "Enter the pickup details and staff initials." };
  return verifyPickup(parsed.data);
}
