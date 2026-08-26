import { z } from "zod";

import { createSessionToken, safeEqual, sessionMaxAgeSeconds } from "@/lib/auth/session";
import { serverEnv } from "@/lib/env";
import { fail, ok } from "@/lib/api/envelope";
import { consumeRateLimit, requestFingerprint } from "@/lib/security/rate-limit";

/**
 * Exchange the staff password for a bearer token.
 *
 * The web sign-in sets an httpOnly cookie; a phone cannot use one. The token
 * itself is identical — the same HMAC over the same expiry, verified by the same
 * function — so there is one notion of a staff session rather than two.
 *
 * Known gap, deliberately not solved here: the token is signed with the shared
 * password, so a lost handset can only be revoked by rotating that password,
 * which signs out every counter tablet at once. That is the staff_devices table
 * in the Phase 3 plan, and it should land before real devices carry these.
 */

const bodySchema = z.object({ password: z.string().min(1) });

export async function POST(request: Request): Promise<Response> {
  /* Same dual-axis limit as the web action. A phone on carrier NAT shares an
     IPv4 with thousands of others, but this is the one endpoint where the
     subject axis does not exist yet — there is no account to key on until the
     password is correct — so the IP axis has to carry it. */
  const limit = await consumeRateLimit("staff-sign-in", await requestFingerprint(), {
    attempts: 5,
    windowMs: 15 * 60_000,
  });
  if (!limit.allowed) {
    return fail("rate_limited", "Too many sign-in attempts. Wait a few minutes and try again.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Send a JSON body.");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return fail("invalid_request", "Send a JSON body.");
  }

  // Constant-time, and the failure says nothing about length or format.
  if (!safeEqual(parsed.data.password, serverEnv().STAFF_DASHBOARD_PASSWORD)) {
    return fail("unauthorized", "That password isn't right.");
  }

  return ok({
    token: await createSessionToken(serverEnv().STAFF_DASHBOARD_PASSWORD),
    expiresInSeconds: sessionMaxAgeSeconds(),
  });
}
