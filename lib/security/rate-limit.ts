import "server-only";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { rateLimits } from "@/lib/db/schema";

export async function requestFingerprint(): Promise<string> {
  const incoming = await headers();
  return rateLimitFingerprint({
    vercelForwardedFor: incoming.get("x-vercel-forwarded-for"),
    forwardedFor: incoming.get("x-forwarded-for"),
    realIp: incoming.get("x-real-ip"),
  });
}

/**
 * Build an IP-stable limiter key. User-Agent is deliberately excluded because
 * it is caller-controlled and would let an attacker rotate buckets at will.
 * Vercel's non-overridable forwarding header wins when it is present.
 */
export function rateLimitFingerprint(
  input: {
    vercelForwardedFor?: string | null;
    forwardedFor?: string | null;
    realIp?: string | null;
  },
): string {
  const forwarded = (input.vercelForwardedFor || input.forwardedFor)
    ?.split(",")[0]
    ?.trim();
  const ip = forwarded || input.realIp?.trim() || "unknown";
  return ip;
}

export async function consumeRateLimit(
  scope: string,
  identifier: string,
  options: { attempts: number; windowMs: number },
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const identifierHash = createHash("sha256").update(identifier).digest("hex");
  // Raw SQL parameters do not pass through the timestamp column encoder. The
  // postgres-js driver rejects Date objects in this path, so bind the cutoff as
  // an ISO string and cast it explicitly in Postgres.
  const cutoff = new Date(Date.now() - options.windowMs).toISOString();
  const rows = await db().execute<{ attempts: number; window_started_at: Date }>(sql`
    INSERT INTO ${rateLimits} (scope, identifier_hash, window_started_at, attempts, updated_at)
    VALUES (${scope}, ${identifierHash}, now(), 1, now())
    ON CONFLICT (scope, identifier_hash) DO UPDATE
      SET attempts = CASE
            WHEN ${rateLimits.windowStartedAt} < ${cutoff}::timestamptz THEN 1
            ELSE ${rateLimits.attempts} + 1
          END,
          window_started_at = CASE
            WHEN ${rateLimits.windowStartedAt} < ${cutoff}::timestamptz THEN now()
            ELSE ${rateLimits.windowStartedAt}
          END,
          updated_at = now()
    RETURNING attempts, window_started_at
  `);
  const row = rows[0];
  const attempts = Number(row?.attempts ?? options.attempts + 1);
  const startedAt = row?.window_started_at ? new Date(row.window_started_at) : new Date();
  return {
    allowed: attempts <= options.attempts,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((startedAt.getTime() + options.windowMs - Date.now()) / 1000),
    ),
  };
}
