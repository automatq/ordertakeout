import "server-only";

import { after } from "next/server";
import { z } from "zod";

import { consumePhoneSignInCode, issuePhoneSignInCode } from "@/lib/accounts/phone-sign-in";
import { sendPhoneSignInCode } from "@/lib/accounts/phone-sign-in-sms";
import { createSignupToken } from "@/lib/accounts/signup-token";
import { normalizePhoneE164 } from "@/lib/phone";
import { consumeRateLimit, requestFingerprint } from "@/lib/security/rate-limit";

/**
 * Signing in with a texted code, for both the website and the app.
 *
 * Lifted out of app/actions/sign-in.ts so the two surfaces cannot drift. What
 * lives here is everything up to the session: normalising the number, the
 * dual-axis rate limits, issuing the code, and sending it. Opening a session is
 * the caller's job, because a browser wants an httpOnly cookie and a phone
 * wants a bearer token, and those are the only parts that differ.
 *
 * Every enumeration-safety property is a property of this file. Callers must
 * not add anything that varies with whether an account exists.
 */

export const phoneRequestSchema = z.object({ phone: z.string().min(1).max(32) });
export const phoneVerifySchema = z.object({
  phone: z.string().min(1).max(32),
  code: z.string().min(1).max(12),
});

/**
 * Identical whether or not the number has an account.
 *
 * Somebody probing numbers learns nothing from the response, and the send
 * happens in `after()` so they learn nothing from how long it took either — a
 * Twilio round-trip is a very loud signal to leave in the response time.
 *
 * It no longer hedges with "if that number has an account". A code now goes to
 * any valid number — an unknown one opens sign-up instead of a session — so the
 * plain sentence is both true and, being unconditional, still says nothing
 * about who is registered.
 */
export const CODE_SENT_MESSAGE =
  "A 6-digit code is on its way. It expires in 10 minutes.";

export type PhoneCodeResult = { ok: true; message: string } | { ok: false; message: string };

export async function requestPhoneCode(input: unknown): Promise<PhoneCodeResult> {
  const parsed = phoneRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter the mobile number you order with." };

  const normalized = normalizePhoneE164(parsed.data.phone);
  if (!normalized.ok) return { ok: false, message: normalized.message };

  /* Two axes. Per IP so one machine cannot spray, per number so a distributed
     spray cannot text one person's phone a hundred times from a hundred IPs. */
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
    after(() => sendPhoneSignInCode({ to: issued.phone, code: issued.code }));
  }

  return { ok: true, message: CODE_SENT_MESSAGE };
}

export type PhoneVerifyResult =
  /** Known number: the caller opens a session however its surface does that. */
  | { ok: true; accountId: string }
  /**
   * Verified, but nobody has this number yet.
   *
   * `signupToken` is the proof that carries forward — it is short-lived, signed
   * and bound to the number, so profile creation can be a separate request
   * without ever trusting a phone number sent by a client.
   */
  | { ok: true; accountId: null; phone: string; signupToken: string }
  | { ok: false; message: string };

/**
 * Guess volume is bounded twice: MAX_CODE_ATTEMPTS kills the code itself, and
 * the IP limit stops somebody cycling fresh codes to reset that counter. The
 * failure never says whether the number, the code, or both were wrong.
 */
export async function verifyPhoneCode(input: unknown): Promise<PhoneVerifyResult> {
  const parsed = phoneVerifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter the 6-digit code we texted you." };

  const normalized = normalizePhoneE164(parsed.data.phone);
  if (!normalized.ok) return { ok: false, message: normalized.message };

  const limit = await consumeRateLimit("phone_verify_ip", await requestFingerprint(), {
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

  if (consumed.kind === "new") {
    return {
      ok: true,
      accountId: null,
      phone: consumed.phone,
      signupToken: await createSignupToken(consumed.phone),
    };
  }

  return { ok: true, accountId: consumed.accountId };
}
