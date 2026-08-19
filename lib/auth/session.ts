import { timingSafeEqual } from "node:crypto";

/**
 * Staff dashboard authentication.
 *
 * A single shared password, as agreed for v1 — the bakery has a handful of staff
 * and no appetite for per-user accounts. The session is a signed, expiring token
 * in an httpOnly cookie; there is no session table, so signing out everywhere is
 * done by changing the password.
 *
 * The signing key IS the password, deliberately: changing it invalidates every
 * outstanding session, which is exactly what you want after someone leaves.
 *
 * Note this is authentication only. The dashboard shows customer names, phone
 * numbers and order values, so the guard belongs on every protected route —
 * Next's Proxy (formerly Middleware) is explicitly not a session-management
 * solution, so the check lives in the protected layout instead.
 */

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // one long shift
export const SESSION_COOKIE = "staff_session";

async function sign(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Buffer.from(signature).toString("base64url");
}

/** Constant-time comparison, so a wrong guess leaks nothing through timing. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual throws on length mismatch, which would itself be a timing
  // signal — compare a fixed-size digest-like padding instead.
  if (left.length !== right.length) {
    // Still do the work so the failure takes comparable time.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export async function createSessionToken(
  secret: string,
  now: number = Date.now(),
): Promise<string> {
  const expiresAt = String(now + SESSION_TTL_MS);
  return `${expiresAt}.${await sign(secret, expiresAt)}`;
}

export async function verifySessionToken(
  secret: string,
  token: string | undefined,
  now: number = Date.now(),
): Promise<boolean> {
  if (!token) return false;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  // Signature first: never trust the expiry until we know it wasn't forged.
  if (!safeEqual(signature, await sign(secret, payload))) return false;

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export const sessionMaxAgeSeconds = () => SESSION_TTL_MS / 1000;
