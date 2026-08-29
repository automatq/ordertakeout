import "server-only";

import { randomBytes } from "node:crypto";

import { and, desc, eq, isNull, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import { staffDevices } from "@/lib/db/schema";

import { safeEqual, sign } from "./session";

/**
 * Staff sessions that can be revoked one handset at a time.
 *
 * The cookie session in ./session.ts signs with the shared dashboard password,
 * so invalidating one session means changing that password and signing out every
 * counter tablet at once, mid-shift. Nobody does that, which in practice means a
 * phone that leaves the shop keeps working until its token expires.
 *
 * Each device gets its own secret instead. Its token is signed with that secret
 * and nothing else, so revoking the row makes exactly one token unverifiable and
 * leaves every other device — and the shared password — untouched.
 *
 * The device secret never leaves the server. The handset holds only a token
 * signed with it, so reading the database does not yield anything replayable as
 * a token, and holding a token does not yield the key.
 */

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Thirty days rather than the cookie's twelve hours.
 *
 * A tablet asked for the password every morning gets the password written on a
 * sticky note beside it. The long life is only defensible *because* revocation
 * now exists: the answer to a lost device is to revoke it, not to hope it
 * expires.
 */
export const DEVICE_TOKEN_TTL_MS = TOKEN_TTL_MS;

/**
 * How stale last_seen may get before it is written again.
 *
 * The queue polls every fifteen seconds. Recording a timestamp on each call
 * would put a database write on the hottest path in the app to gain a precision
 * nobody reads — the device list says "2 hours ago", not "2 seconds ago".
 */
const LAST_SEEN_MAX_STALENESS_MS = 15 * 60_000;

export interface DeviceToken {
  deviceId: string;
  token: string;
  expiresAt: Date;
}

const payloadFor = (deviceId: string, expiresAt: number) => `${deviceId}.${expiresAt}`;

export async function registerDevice(
  label: string,
  platform: string | null,
  now: number = Date.now(),
): Promise<DeviceToken> {
  /* 32 bytes from the CSPRNG. This is an HMAC key, not an identifier — it never
     appears in a URL, a log line, or on the device. */
  const secret = randomBytes(32).toString("base64url");

  const [device] = await db()
    .insert(staffDevices)
    .values({ label, platform, secret })
    .returning({ id: staffDevices.id });

  const expiresAt = now + TOKEN_TTL_MS;
  const signature = await sign(secret, payloadFor(device!.id, expiresAt));

  return {
    deviceId: device!.id,
    token: `${device!.id}.${expiresAt}.${signature}`,
    expiresAt: new Date(expiresAt),
  };
}

/**
 * Verify a bearer token and say which device it belongs to.
 *
 * Order matters: parse, then look the device up, then check the signature, then
 * the expiry. Checking the signature before trusting the expiry means a forged
 * token cannot simply claim a distant expiry; looking the device up first is
 * what makes revocation immediate rather than eventual.
 */
export async function verifyDeviceToken(
  token: string | undefined,
  now: number = Date.now(),
): Promise<{ deviceId: string } | null> {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [deviceId, expiresText, signature] = parts as [string, string, string];

  const [device] = await db()
    .select({ id: staffDevices.id, secret: staffDevices.secret })
    .from(staffDevices)
    .where(and(eq(staffDevices.id, deviceId), isNull(staffDevices.revokedAt)))
    .limit(1);
  // Revoked or deleted: the row is the authority, not the signature.
  if (!device) return null;

  if (!safeEqual(signature, await sign(device.secret, payloadFor(deviceId, Number(expiresText))))) {
    return null;
  }

  const expiresAt = Number(expiresText);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;

  return { deviceId };
}

/** Record that a device is still in use, cheaply. */
export async function touchDevice(deviceId: string, now: Date = new Date()): Promise<void> {
  await db()
    .update(staffDevices)
    .set({ lastSeenAt: now })
    .where(
      and(
        eq(staffDevices.id, deviceId),
        lt(staffDevices.lastSeenAt, new Date(now.getTime() - LAST_SEEN_MAX_STALENESS_MS)),
      ),
    );
}

export interface StaffDeviceRow {
  id: string;
  label: string;
  platform: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}

/** Every device, revoked ones included — a revoked row is the audit trail. */
export async function listStaffDevices(): Promise<StaffDeviceRow[]> {
  return db()
    .select({
      id: staffDevices.id,
      label: staffDevices.label,
      platform: staffDevices.platform,
      createdAt: staffDevices.createdAt,
      lastSeenAt: staffDevices.lastSeenAt,
      revokedAt: staffDevices.revokedAt,
    })
    .from(staffDevices)
    .orderBy(desc(staffDevices.lastSeenAt));
}

/**
 * Revoke a device. Idempotent, and it never resurrects one.
 *
 * Returns whether this call was the one that revoked it, so a second press of
 * the button does not claim to have done something.
 */
export async function revokeDevice(deviceId: string, now: Date = new Date()): Promise<boolean> {
  const revoked = await db()
    .update(staffDevices)
    .set({ revokedAt: now })
    .where(and(eq(staffDevices.id, deviceId), isNull(staffDevices.revokedAt)))
    .returning({ id: staffDevices.id });
  return revoked.length > 0;
}
