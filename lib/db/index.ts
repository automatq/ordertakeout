import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { serverEnv } from "@/lib/env";

import * as schema from "./schema";

let cachedDb: ReturnType<typeof drizzle<typeof schema>> | undefined;

/**
 * Database handle.
 *
 * `prepare: false` is required for transaction-pooled connections (Supabase's
 * pgBouncer, Neon's pooler) which are the likely production setup on Vercel;
 * prepared statements don't survive a pooler handing you a different backend.
 */
export function db() {
  if (!cachedDb) {
    const client = postgres(serverEnv().DATABASE_URL, { prepare: false });
    cachedDb = drizzle(client, { schema });
  }
  return cachedDb;
}

export * from "./schema";
