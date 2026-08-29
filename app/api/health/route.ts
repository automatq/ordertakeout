import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { publicEnv, serverEnv } from "@/lib/env";

/**
 * Anonymous liveness probe for uptime monitors.
 *
 * Deliberately cheap and self-contained: one database round-trip behind a hard
 * timeout, no Square API call (a health check must never spend rate limit or
 * hang on a third party), and no auth (monitors can't send secrets). The body
 * carries no connection details — just enough to tell "app up, database down"
 * from "misconfigured deploy".
 */

const DB_TIMEOUT_MS = 3_000;

export async function GET() {
  let environment: string;
  try {
    serverEnv();
    environment = publicEnv().NEXT_PUBLIC_SQUARE_ENVIRONMENT;
  } catch {
    return Response.json({ ok: false, config: "invalid" }, { status: 503 });
  }

  try {
    await Promise.race([
      db().execute(sql`select 1`),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("database ping timed out")), DB_TIMEOUT_MS),
      ),
    ]);
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503 });
  }

  return Response.json({
    ok: true,
    db: "up",
    environment,
    time: new Date().toISOString(),
  });
}
