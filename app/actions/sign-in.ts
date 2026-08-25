"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { consumeMagicLink, issueMagicLink } from "@/lib/accounts/magic-link";
import { sendMagicLinkEmail } from "@/lib/accounts/magic-link-email";
import { consumePhoneSignInCode, issuePhoneSignInCode } from "@/lib/accounts/phone-sign-in";
import { sendPhoneSignInCode } from "@/lib/accounts/phone-sign-in-sms";
import { setAccountSession } from "@/lib/accounts/session";
import { normalizePhoneE164 } from "@/lib/phone";
import { serverEnv } from "@/lib/env";
import { consumeRateLimit, requestFingerprint } from "@/lib/security/rate-limit";

const requestSchema = z.object({ email: z.email().max(254) });

export type SignInRequestResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * The success message never depends on whether the account exists — an
 * attacker probing addresses learns nothing. Rate limits are dual: per IP so
 * one machine can't spray, per email so a distributed spray can't flood one
 * victim's inbox from many IPs.
 */
const SENT_MESSAGE =
  "If that email has an account with us, a sign-in link is on its way. It works once and expires in 15 minutes.";

export async function requestSignInLink(formData: FormData): Promise<SignInRequestResult> {
  const parsed = requestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { ok: false, message: "Enter the email address you order with." };
  const email = parsed.data.email.trim().toLowerCase();

  const ip = await requestFingerprint();
  const [byIp, byEmail] = await Promise.all([
    consumeRateLimit("magic_link_ip", ip, { attempts: 5, windowMs: 15 * 60_000 }),
    consumeRateLimit("magic_link_email", email, { attempts: 3, windowMs: 15 * 60_000 }),
  ]);
  if (!byIp.allowed || !byEmail.allowed) {
    const retryAfter = Math.max(byIp.retryAfterSeconds, byEmail.retryAfterSeconds);
    return {
      ok: false,
      message: `Too many sign-in requests. Try again in about ${Math.max(1, Math.ceil(retryAfter / 60))} minute${retryAfter > 90 ? "s" : ""}.`,
    };
  }

  const base = await signInBaseUrl();
  if (!base) return { ok: true, message: SENT_MESSAGE };

  const issued = await issueMagicLink(email);
  if (issued) {
    /* Deliberately not awaited. Awaiting the provider round-trip only when the
       account exists turns response time into an oracle for "is this address
       registered" — a known address costs a Resend call, an unknown one returns
       immediately, and that gap is trivially measurable against a JSON client.
       after() sends once the response is already on its way, so both branches
       return in the same time and the uniform message above stays honest. */
    after(() =>
      sendMagicLinkEmail({
        to: issued.account.email,
        name: issued.account.name,
        url: `${base}/account/sign-in/confirm?token=${encodeURIComponent(issued.token)}`,
      }),
    );
  }

  // Identical response whether the account existed, was capped, or the email
  // failed to send — see enumeration note above.
  return { ok: true, message: SENT_MESSAGE };
}

/**
 * STORE_PUBLIC_URL is the only trusted base for a credential-bearing link —
 * request Host headers are caller-controlled and would let an attacker mail a
 * victim a link pointing at their own domain. Development falls back to
 * localhost, which no header can spoof usefully.
 */
async function signInBaseUrl(): Promise<string | null> {
  const configured = serverEnv().STORE_PUBLIC_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.NODE_ENV !== "production") {
    const host = (await headers()).get("host");
    if (host?.startsWith("localhost") || host?.startsWith("127.0.0.1")) return `http://${host}`;
  }
  return null;
}

/**
 * POST-only consumption. Mail scanners GET every link in an email; the confirm
 * page renders a button and only this action redeems the token, so a scanner
 * can't burn it before the human arrives.
 */
export async function confirmSignIn(formData: FormData): Promise<{ ok: false; message: string }> {
  const token = formData.get("token");
  const consumed = typeof token === "string" && token.length > 0 && token.length <= 128
    ? await consumeMagicLink(token)
    : null;

  if (!consumed) {
    return {
      ok: false,
      message: "That sign-in link has expired or was already used. Request a fresh one below.",
    };
  }

  await setAccountSession(consumed.accountId);
  redirect("/account");
}

/* -------------------------------------------------------------------------- */
/* Phone sign-in                                                              */
/* -------------------------------------------------------------------------- */

const phoneRequestSchema = z.object({ phone: z.string().min(1).max(32) });
const phoneVerifySchema = z.object({
  phone: z.string().min(1).max(32),
  code: z.string().min(1).max(12),
});

const CODE_SENT_MESSAGE =
  "If that number has an account with us, a 6-digit code is on its way. It expires in 10 minutes.";

/**
 * Text a one-time sign-in code.
 *
 * Same enumeration contract as the email link: the caller cannot tell an
 * unknown number from a known one, or from a number shared by two accounts.
 * Rate limited on both axes — per IP so one machine can't spray, per number so
 * a distributed spray can't flood one person's phone. Unlike email, every send
 * costs money, so the limits are the spend control too.
 */
export async function requestPhoneSignInCode(formData: FormData): Promise<SignInRequestResult> {
  const parsed = phoneRequestSchema.safeParse({ phone: formData.get("phone") });
  if (!parsed.success) return { ok: false, message: "Enter the mobile number you order with." };

  const normalized = normalizePhoneE164(parsed.data.phone);
  if (!normalized.ok) return { ok: false, message: normalized.message };

  const ip = await requestFingerprint();
  const [byIp, byPhone] = await Promise.all([
    consumeRateLimit("phone_code_ip", ip, { attempts: 5, windowMs: 15 * 60_000 }),
    consumeRateLimit("phone_code_number", normalized.e164, { attempts: 3, windowMs: 15 * 60_000 }),
  ]);
  if (!byIp.allowed || !byPhone.allowed) {
    const retryAfter = Math.max(byIp.retryAfterSeconds, byPhone.retryAfterSeconds);
    return {
      ok: false,
      message: `Too many code requests. Try again in about ${Math.max(1, Math.ceil(retryAfter / 60))} minute${retryAfter > 90 ? "s" : ""}.`,
    };
  }

  const issued = await issuePhoneSignInCode(normalized.e164);
  if (issued) {
    // Same timing-oracle reasoning as the email path above — a Twilio round-trip
    // is an even louder signal than a Resend one.
    after(() => sendPhoneSignInCode({ to: issued.account.phone, code: issued.code }));
  }

  return { ok: true, message: CODE_SENT_MESSAGE };
}

/**
 * Verify a texted code and open a session.
 *
 * Guess volume is bounded twice over: `MAX_CODE_ATTEMPTS` kills the code
 * itself, and the IP limit stops someone cycling fresh codes to reset that
 * counter. The failure message never says whether the number, the code, or
 * both were wrong.
 */
export async function verifyPhoneSignInCode(formData: FormData): Promise<{ ok: false; message: string }> {
  const parsed = phoneVerifySchema.safeParse({
    phone: formData.get("phone"),
    code: formData.get("code"),
  });
  if (!parsed.success) return { ok: false, message: "Enter the 6-digit code we texted you." };

  const normalized = normalizePhoneE164(parsed.data.phone);
  if (!normalized.ok) return { ok: false, message: normalized.message };

  const ip = await requestFingerprint();
  const limit = await consumeRateLimit("phone_verify_ip", ip, {
    attempts: 10,
    windowMs: 15 * 60_000,
  });
  if (!limit.allowed) {
    return { ok: false, message: "Too many attempts. Please wait a few minutes and try again." };
  }

  const consumed = await consumePhoneSignInCode(normalized.e164, parsed.data.code);
  if (!consumed) {
    return {
      ok: false,
      message: "That code is wrong or has expired. Request a new one and try again.",
    };
  }

  await setAccountSession(consumed.accountId);
  redirect("/account");
}
