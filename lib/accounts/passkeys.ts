import "server-only";

import { and, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

import { db } from "@/lib/db";
import { customerPasskeys } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { STORE_INFO } from "@/lib/store";

/**
 * Passkey sign-in.
 *
 * A third method beside the magic link and the SMS code, and the only one that
 * is phishing-resistant: the browser binds the credential to this origin, so a
 * convincing lookalike domain cannot use it. It is also the cheapest — no
 * Resend email, no Twilio message, no round trip at all.
 *
 * Credentials are discoverable (`residentKey: "required"`) so the customer taps
 * one button and picks an account from the browser's own prompt. Asking for an
 * email first would make it slower than the magic link it is meant to replace.
 */

const CHALLENGE_COOKIE = "passkey_challenge";
const CHALLENGE_TTL_SECONDS = 5 * 60;

export interface PasskeySummary {
  id: string;
  deviceLabel: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/**
 * Relying-party identity.
 *
 * The RP ID is the bare registered domain with any `www.` stripped. This is a
 * one-way decision: a credential enrolled against `www.example.com` cannot be
 * used on `example.com`, so scoping it to the apex now is what keeps every
 * existing passkey working if the site ever drops or adds the subdomain — or if
 * a native app later claims the same domain.
 *
 * Both origins are accepted so a customer who happens to be on `www.` can still
 * sign in with a credential the browser scoped to the apex.
 */
export interface RelyingParty {
  rpID: string;
  origins: string[];
}

/**
 * Derive the relying party from the public URL.
 *
 * Pure and exported because this is a one-way decision: a credential enrolled
 * against `www.example.com` cannot be used on `example.com` or by a native app
 * claiming the apex. Getting it wrong is only discoverable once real customers
 * have enrolled, and the fix at that point is asking all of them to enrol
 * again — so it gets a test rather than a comment.
 */
export function deriveRelyingParty(publicUrl: string | null | undefined): RelyingParty | null {
  if (!publicUrl) return null;
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    return null;
  }
  const rpID = url.hostname.replace(/^www\./, "");
  if (!rpID) return null;
  // The port is part of the origin the browser reports; dropping it would make
  // every verification fail on any deployment not served from the default port.
  const port = url.port ? `:${url.port}` : "";
  return {
    rpID,
    origins: [`${url.protocol}//${rpID}${port}`, `${url.protocol}//www.${rpID}${port}`],
  };
}

async function relyingParty(): Promise<RelyingParty | null> {
  const configured = deriveRelyingParty(serverEnv().STORE_PUBLIC_URL);
  if (configured) return configured;

  /* Development only, derived from the request host so any port works.
     Deliberately never reached in production, where a caller-controlled Host
     header would be a real concern — and even here the browser refuses to
     release a credential whose RP ID does not match the page's own origin, so
     a spoofed host produces a verification failure rather than a valid
     credential for someone else's domain. */
  if (process.env.NODE_ENV !== "production") {
    const host = (await headers()).get("host");
    if (host?.startsWith("localhost") || host?.startsWith("127.0.0.1")) {
      return { rpID: host.split(":")[0]!, origins: [`http://${host}`] };
    }
  }
  return null;
}

/** True when passkeys can be offered at all — used to hide the UI rather than fail it. */
export async function passkeysConfigured(): Promise<boolean> {
  return (await relyingParty()) !== null;
}

async function rememberChallenge(challenge: string): Promise<void> {
  (await cookies()).set(CHALLENGE_COOKIE, challenge, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CHALLENGE_TTL_SECONDS,
  });
}

/**
 * Read and immediately clear the pending challenge.
 *
 * Cleared before verification rather than after, so a failed attempt cannot be
 * retried against the same challenge — the client must ask for a fresh one.
 */
async function takeChallenge(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(CHALLENGE_COOKIE)?.value ?? null;
  if (value) jar.delete(CHALLENGE_COOKIE);
  return value;
}

export async function beginPasskeyRegistration(account: {
  id: string;
  email: string;
  name: string;
}) {
  const rp = await relyingParty();
  if (!rp) return null;

  const existing = await db()
    .select({ credentialId: customerPasskeys.credentialId, transports: customerPasskeys.transports })
    .from(customerPasskeys)
    .where(eq(customerPasskeys.customerAccountId, account.id));

  const options = await generateRegistrationOptions({
    rpName: STORE_INFO.name,
    rpID: rp.rpID,
    userID: new TextEncoder().encode(account.id),
    userName: account.email,
    userDisplayName: account.name,
    // Nothing here needs an attestation statement, and asking for one shows the
    // customer an extra "share device info?" prompt for no benefit.
    attestationType: "none",
    // Offering a key the account already has makes the browser say so instead
    // of silently creating a duplicate.
    excludeCredentials: existing.map((row) => ({
      id: row.credentialId,
      transports: row.transports as never,
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
  });

  await rememberChallenge(options.challenge);
  return options;
}

export async function finishPasskeyRegistration(
  accountId: string,
  response: RegistrationResponseJSON,
  deviceLabel: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const rp = await relyingParty();
  const expectedChallenge = await takeChallenge();
  if (!rp || !expectedChallenge) {
    return { ok: false, reason: "That request expired. Try adding the passkey again." };
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpID,
    });
  } catch {
    return { ok: false, reason: "That passkey couldn't be verified. Try again." };
  }

  if (!verification.verified) {
    return { ok: false, reason: "That passkey couldn't be verified. Try again." };
  }

  const { credential } = verification.registrationInfo;
  await db()
    .insert(customerPasskeys)
    .values({
      customerAccountId: accountId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: (credential.transports ?? []) as string[],
      deviceLabel,
    })
    // Re-enrolling the same authenticator is a no-op, not an error.
    .onConflictDoNothing({ target: customerPasskeys.credentialId });

  return { ok: true };
}

export async function beginPasskeyAuthentication() {
  const rp = await relyingParty();
  if (!rp) return null;

  // No allowCredentials: the browser offers whichever discoverable credential
  // it holds for this origin, which is what makes this one tap.
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: "preferred",
  });

  await rememberChallenge(options.challenge);
  return options;
}

export async function finishPasskeyAuthentication(
  response: AuthenticationResponseJSON,
): Promise<{ ok: true; accountId: string } | { ok: false; reason: string }> {
  const rp = await relyingParty();
  const expectedChallenge = await takeChallenge();
  if (!rp || !expectedChallenge) {
    return { ok: false, reason: "That sign-in attempt expired. Try again." };
  }

  const [stored] = await db()
    .select()
    .from(customerPasskeys)
    .where(eq(customerPasskeys.credentialId, response.id))
    .limit(1);
  if (!stored) return { ok: false, reason: "That passkey isn't registered here." };

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpID,
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")),
        counter: stored.counter,
        transports: stored.transports as never,
      },
    });
  } catch {
    return { ok: false, reason: "That passkey couldn't be verified. Try again." };
  }

  if (!verification.verified) {
    return { ok: false, reason: "That passkey couldn't be verified. Try again." };
  }

  /* Counter regression means the authenticator has been cloned. Platform
     authenticators report 0 forever, so only a strictly increasing counter is
     meaningful — 0 stays 0 and is not treated as a regression. */
  const { newCounter } = verification.authenticationInfo;
  if (newCounter > 0 && newCounter <= stored.counter) {
    return { ok: false, reason: "That passkey couldn't be verified. Try again." };
  }

  await db()
    .update(customerPasskeys)
    .set({ counter: newCounter, lastUsedAt: new Date() })
    .where(eq(customerPasskeys.id, stored.id));

  return { ok: true, accountId: stored.customerAccountId };
}

export async function listPasskeys(accountId: string): Promise<PasskeySummary[]> {
  return db()
    .select({
      id: customerPasskeys.id,
      deviceLabel: customerPasskeys.deviceLabel,
      createdAt: customerPasskeys.createdAt,
      lastUsedAt: customerPasskeys.lastUsedAt,
    })
    .from(customerPasskeys)
    .where(eq(customerPasskeys.customerAccountId, accountId));
}

/** Scoped to the account so one customer can never delete another's credential. */
export async function deletePasskey(accountId: string, passkeyId: string): Promise<boolean> {
  const rows = await db()
    .delete(customerPasskeys)
    .where(and(eq(customerPasskeys.id, passkeyId), eq(customerPasskeys.customerAccountId, accountId)))
    .returning({ id: customerPasskeys.id });
  return rows.length > 0;
}
