import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { eq, like } from "drizzle-orm";
import type { z } from "zod";

import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { reportError } from "@/lib/monitoring/report";

/**
 * Typed access to the app_settings key/value table — the "staff-editable
 * settings without a redeploy" escape hatch, finally wired up.
 *
 * Callers own their key constants and zod schemas; a stored value that fails
 * its schema reads as unset (and is reported) rather than crashing the caller —
 * a bad row in a settings table must never take down checkout.
 *
 * Two read paths on purpose:
 * - `getSettingCached` for display surfaces (banner, dashboards): "use cache"
 *   with a minutes life plus SETTINGS_TAG invalidation, so read-time-evaluated
 *   values (like a pause auto-resume) propagate within minutes even without a
 *   write.
 * - `getSettingFresh` for enforcement (checkout, money paths): always the
 *   database, never a cache-propagation question.
 *
 * Writers must call `updateTag(SETTINGS_TAG)` from their server action —
 * `setSetting` itself can't, because updateTag is action/route-scoped.
 */

export const SETTINGS_TAG = "app-settings";

/** Raw jsonb by key. Cached layer keeps its argument serializable ("use cache" keys on it). */
async function readRawSettingCached(key: string): Promise<unknown> {
  "use cache";
  cacheLife("minutes");
  cacheTag(SETTINGS_TAG);
  return readRawSetting(key);
}

async function readRawSetting(key: string): Promise<unknown> {
  const [row] = await db()
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return row ? row.value : null;
}

function parseSetting<T>(key: string, schema: z.ZodType<T>, value: unknown): T | null {
  if (value === null || value === undefined) return null;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    reportError("settings", "stored value failed validation; treating as unset", undefined, {
      key,
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
    return null;
  }
  return parsed.data;
}

export async function getSettingCached<T>(key: string, schema: z.ZodType<T>): Promise<T | null> {
  return parseSetting(key, schema, await readRawSettingCached(key));
}

export async function getSettingFresh<T>(key: string, schema: z.ZodType<T>): Promise<T | null> {
  return parseSetting(key, schema, await readRawSetting(key));
}

/** Validates before writing — a schema-invalid value must never reach the table. */
export async function setSetting<T>(key: string, schema: z.ZodType<T>, value: T): Promise<void> {
  const validated = schema.parse(value);
  await db()
    .insert(appSettings)
    .values({ key, value: validated, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: validated, updatedAt: new Date() },
    });
}

export async function deleteSetting(key: string): Promise<void> {
  await db().delete(appSettings).where(eq(appSettings.key, key));
}

/** One-query fresh read of every key under a prefix; invalid values are skipped (and reported). */
export async function listSettingsByPrefixFresh<T>(
  prefix: string,
  schema: z.ZodType<T>,
): Promise<Map<string, T>> {
  const rows = await db()
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(like(appSettings.key, `${prefix}%`));
  const parsed = new Map<string, T>();
  for (const row of rows) {
    const value = parseSetting(row.key, schema, row.value);
    if (value !== null) parsed.set(row.key, value);
  }
  return parsed;
}
