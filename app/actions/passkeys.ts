"use server";

import { redirect } from "next/navigation";

import { getCurrentCustomerAccount } from "@/lib/accounts/loyalty";
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  deletePasskey,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  listPasskeys,
} from "@/lib/accounts/passkeys";
import { setAccountSession } from "@/lib/accounts/session";
import { consumeRateLimit, requestFingerprint } from "@/lib/security/rate-limit";

/**
 * Passkey enrolment and sign-in.
 *
 * The registration half requires an existing session by design: a passkey is a
 * second way into an account that already exists, never a way to create one.
 * Enrolment is therefore only reachable from the signed-in account page, after
 * the customer has proved themselves with a magic link or an SMS code.
 */

export type PasskeyResult = { ok: true } | { ok: false; message: string };

export async function startPasskeyRegistration() {
  const account = await getCurrentCustomerAccount();
  if (!account) return null;
  return beginPasskeyRegistration(account);
}

export async function completePasskeyRegistration(
  response: unknown,
  deviceLabel: unknown,
): Promise<PasskeyResult> {
  const account = await getCurrentCustomerAccount();
  if (!account) return { ok: false, message: "Sign in first, then add a passkey." };

  const label =
    typeof deviceLabel === "string" && deviceLabel.trim()
      ? deviceLabel.trim().slice(0, 60)
      : null;

  const result = await finishPasskeyRegistration(
    account.id,
    response as Parameters<typeof finishPasskeyRegistration>[1],
    label,
  );
  return result.ok ? { ok: true } : { ok: false, message: result.reason };
}

export async function startPasskeySignIn() {
  /* Cheap compared with an email or an SMS, but still a database read and a
     challenge cookie per call, so it gets the same treatment as the others. */
  const limit = await consumeRateLimit("passkey_start_ip", await requestFingerprint(), {
    attempts: 30,
    windowMs: 15 * 60_000,
  });
  if (!limit.allowed) return null;
  return beginPasskeyAuthentication();
}

export async function completePasskeySignIn(
  response: unknown,
): Promise<{ ok: false; message: string }> {
  const limit = await consumeRateLimit("passkey_verify_ip", await requestFingerprint(), {
    attempts: 20,
    windowMs: 15 * 60_000,
  });
  if (!limit.allowed) {
    return { ok: false, message: "Too many attempts. Please wait a few minutes and try again." };
  }

  const result = await finishPasskeyAuthentication(
    response as Parameters<typeof finishPasskeyAuthentication>[0],
  );
  if (!result.ok) return { ok: false, message: result.reason };

  await setAccountSession(result.accountId);
  redirect("/account");
}

export async function removePasskey(passkeyId: unknown): Promise<PasskeyResult> {
  const account = await getCurrentCustomerAccount();
  if (!account) return { ok: false, message: "Sign in first." };
  if (typeof passkeyId !== "string" || !passkeyId) {
    return { ok: false, message: "That passkey no longer exists." };
  }

  // Scoped to the account inside the query, so an id from another customer
  // simply matches nothing.
  const removed = await deletePasskey(account.id, passkeyId);
  return removed ? { ok: true } : { ok: false, message: "That passkey no longer exists." };
}

export async function currentPasskeys() {
  const account = await getCurrentCustomerAccount();
  return account ? listPasskeys(account.id) : [];
}
