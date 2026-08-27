"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { consumeMagicLink, issueMagicLink } from "@/lib/accounts/magic-link";
import { sendMagicLinkEmail } from "@/lib/accounts/magic-link-email";
import { requestPhoneCode, verifyPhoneCode } from "@/lib/accounts/phone-auth";
import { setAccountSession } from "@/lib/accounts/session";
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

/**
 * Text a sign-in code.
 *
 * A thin adapter over lib/accounts/phone-auth.ts, which the app's API route
 * also calls — every enumeration-safety property lives there so the two
 * surfaces cannot drift apart.
 */
export async function requestPhoneSignInCode(formData: FormData): Promise<SignInRequestResult> {
  return requestPhoneCode({ phone: formData.get("phone") });
}

/** Verify a texted code and open a browser session. */
export async function verifyPhoneSignInCode(formData: FormData): Promise<{ ok: false; message: string }> {
  const result = await verifyPhoneCode({
    phone: formData.get("phone"),
    code: formData.get("code"),
  });
  if (!result.ok) return result;

  await setAccountSession(result.accountId);
  redirect("/account");
}
