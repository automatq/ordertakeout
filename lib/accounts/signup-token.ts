import "server-only";

import { timingSafeEqual } from "node:crypto";

import { serverEnv } from "@/lib/env";

/**
 * Proof that somebody just answered a code texted to a number.
 *
 * Profile creation happens on a second request — the customer still has a name
 * and an email to type — so the fact that the number was verified has to
 * survive the round trip. Sending the bare number back would let anyone create
 * a profile against any number simply by posting one.
 *
 * Deliberately not a database row. It is single-purpose, expires in minutes,
 * and the code it descends from has already been burned in `phone_sign_in_codes`;
 * a table here would add a sweep and a race for no additional guarantee.
 *
 * Mirrors the HMAC shape of lib/accounts/session.ts, with its own domain prefix
 * so a signup token can never be presented as a session token or the reverse.
 */

/** Long enough to type a name and an email, short enough to be worthless later. */
const SIGNUP_TTL_MS = 15 * 60_000;

function secret() {
  return serverEnv().CUSTOMER_ACCOUNT_SECRET
    ?? serverEnv().ORDER_ACCESS_SECRET
    ?? serverEnv().STAFF_DASHBOARD_PASSWORD;
}

async function signature(payload: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return Buffer.from(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`signup:${payload}`)),
  ).toString("base64url");
}

/** `phone` must already be E.164 — it is what the token attests to. */
export async function createSignupToken(phone: string, now = Date.now()): Promise<string> {
  const payload = `${phone}.${now + SIGNUP_TTL_MS}`;
  return `${payload}.${await signature(payload)}`;
}

/** The number this token attests to, or null if it is forged, stale or malformed. */
export async function phoneFromSignupToken(
  token: string | undefined,
  now = Date.now(),
): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [phone, expiry, received] = parts;
  if (!phone || !/^\+\d{8,15}$/.test(phone)) return null;

  const expected = Buffer.from(await signature(`${phone}.${expiry}`));
  const presented = Buffer.from(received ?? "");
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) return null;

  const expiresAt = Number(expiry);
  return Number.isFinite(expiresAt) && expiresAt > now ? phone : null;
}

/**
 * The signup token is carried in a cookie rather than the URL.
 *
 * A query parameter would survive in browser history, in the Referer sent to
 * any third-party asset on the page, and in whatever the customer pastes into a
 * chat window. This is a credential — short-lived, but a credential.
 */
const SIGNUP_COOKIE = "customer_signup";

export async function setSignupSession(phone: string) {
  const { cookies } = await import("next/headers");
  (await cookies()).set(SIGNUP_COOKIE, await createSignupToken(phone), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SIGNUP_TTL_MS / 1000,
  });
}

/** The verified number waiting on a profile in this browser, if any. */
export async function currentSignupPhone(): Promise<string | null> {
  const { cookies } = await import("next/headers");
  return phoneFromSignupToken((await cookies()).get(SIGNUP_COOKIE)?.value);
}

export async function clearSignupSession() {
  const { cookies } = await import("next/headers");
  (await cookies()).delete(SIGNUP_COOKIE);
}
