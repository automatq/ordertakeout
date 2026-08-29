import { z } from "zod";

import { safeEqual } from "@/lib/auth/session";
import { registerDevice } from "@/lib/auth/device-session";
import { serverEnv } from "@/lib/env";
import { recordAudit } from "@/lib/audit/log";
import { fail, ok } from "@/lib/api/envelope";
import { consumeRateLimit, requestFingerprint } from "@/lib/security/rate-limit";

/**
 * Exchange the staff password for a bearer token.
 *
 * The web sign-in sets an httpOnly cookie; a phone cannot use one. The token
 * itself is identical — the same HMAC over the same expiry, verified by the same
 * function — so there is one notion of a staff session rather than two.
 *
 * The token is per-device: signing in registers a row in staff_devices with its
 * own secret, and revoking that row invalidates this token alone. The shared
 * password authorises the sign-in and is then out of the picture, so losing a
 * handset no longer means signing out every tablet in the shop.
 */

const bodySchema = z.object({
  password: z.string().min(1),
  /* What the shop will see in the device list. Trimmed and bounded because it is
     rendered on a staff screen and supplied by the client. */
  deviceLabel: z.string().trim().min(1).max(60).optional(),
  platform: z.enum(["ios", "android"]).optional(),
});

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

  /* One row per sign-in, not per handset. Signing in twice on the same tablet
     makes two devices, which is the honest record — the first token is still
     live until someone revokes it, and pretending otherwise would hide a
     session that really does exist. */
  const device = await registerDevice(
    parsed.data.deviceLabel ?? "Staff device",
    parsed.data.platform ?? null,
  );

  await recordAudit({
    actorType: "staff",
    action: "staff_device.registered",
    entityType: "staff_device",
    entityId: device.deviceId,
    metadata: { label: parsed.data.deviceLabel ?? null, platform: parsed.data.platform ?? null },
  });

  return ok({
    token: device.token,
    expiresInSeconds: Math.floor((device.expiresAt.getTime() - Date.now()) / 1000),
  });
}
