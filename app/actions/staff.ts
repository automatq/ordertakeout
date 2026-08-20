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

/** Polled by the order screen. */
export async function refreshDashboard(): Promise<DashboardData> {
  await requireStaffSession();
  return getDashboardData();
}

const transitionSchema = z.object({
  orderId: z.uuid(),
  status: z.enum(["preparing", "ready", "completed", "canceled"]),
});

export async function changeOrderStatus(input: unknown): Promise<TransitionResult> {
  await requireStaffSession();

  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "That status change isn't valid." };
  }

  return advanceOrder(parsed.data.orderId, parsed.data.status);
}
