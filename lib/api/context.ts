import "server-only";

import { accountIdFromSession } from "@/lib/accounts/session";
import { touchDevice, verifyDeviceToken } from "@/lib/auth/device-session";
import { rateLimitFingerprint } from "@/lib/security/rate-limit";

/**
 * The Next-specific surface of a request, resolved for a bearer client.
 *
 * The web guard in lib/auth/guard.ts reads a cookie and `redirect()`s. Neither
 * works for a phone: it never sends the cookie, and a 302 to /staff/login is not
 * something a JSON client can act on.
 *
 * Bearer tokens are per-device rather than the shared cookie token, so that a
 * lost handset can be revoked without rotating the password every counter tablet
 * depends on. See lib/auth/device-session.ts.
 */
export async function staffDeviceFromRequest(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization");
  if (!header) return null;

  /* Case-insensitive scheme, exactly one space: some HTTP clients send "bearer".
     Anything else is malformed rather than merely wrong, and is rejected the
     same way so neither case is distinguishable from the outside. */
  const match = /^Bearer (.+)$/i.exec(header.trim());
  if (!match) return null;

  const session = await verifyDeviceToken(match[1]);
  if (!session) return null;

  /* Cheap and lazy — see touchDevice. Deliberately not awaited into the response
     path: a slow write should not delay a kitchen screen, and a failed one
     should not fail the request. */
  void touchDevice(session.deviceId).catch(() => {});

  return session.deviceId;
}

/**
 * The rate-limit key for a bearer client.
 *
 * Same derivation as the web's `requestFingerprint()`, reading the request it
 * was handed instead of `headers()`. Both go through `rateLimitFingerprint`, so
 * the header precedence — and the reason User-Agent is excluded — lives in one
 * place and cannot drift between the two surfaces.
 */
export function fingerprintFromRequest(request: Request): string {
  return rateLimitFingerprint({
    vercelForwardedFor: request.headers.get("x-vercel-forwarded-for"),
    forwardedFor: request.headers.get("x-forwarded-for"),
    realIp: request.headers.get("x-real-ip"),
  });
}

/**
 * The customer account behind a bearer request, or null.
 *
 * The mirror of `staffDeviceFromRequest` for the storefront's own customers:
 * the web reads a cookie, the app carries the same signed token in a header.
 * Extracted once there was a second reader — the orders history and the rewards
 * balance must agree on what counts as signed in, and a copied regex is exactly
 * how two endpoints quietly stop agreeing.
 */
export async function customerAccountFromRequest(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization");
  if (!header) return null;

  const match = /^Bearer (.+)$/i.exec(header.trim());
  if (!match) return null;

  return accountIdFromSession(match[1]);
}
