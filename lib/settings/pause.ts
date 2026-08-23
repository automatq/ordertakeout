import "server-only";

import { z } from "zod";

import {
  getSettingCached,
  getSettingFresh,
  listSettingsByPrefixFresh,
  setSetting,
} from "./store";

/**
 * The pause-ordering kill switch — "we're slammed, stop taking orders."
 *
 * Stored per scope in app_settings (`ordering.pause.global` plus one key per
 * location). Auto-resume is evaluated at READ time: a pause with a resumeAt in
 * the past simply reads as not paused, so no cron is needed for correctness,
 * and the cached storefront banner catches up within its minutes-scale life.
 * Enforcement paths (checkout) always use the fresh readers — pausing must
 * never depend on cache propagation.
 */

export const PAUSE_KEY_PREFIX = "ordering.pause.";
export const GLOBAL_PAUSE_KEY = `${PAUSE_KEY_PREFIX}global`;
export const pauseKeyForLocation = (locationId: string): string => `${PAUSE_KEY_PREFIX}${locationId}`;

export const pauseSettingSchema = z.object({
  paused: z.boolean(),
  /** Shown to customers on the storefront banner — keep it public-safe. */
  note: z.string().max(200).nullable(),
  resumeAt: z.iso.datetime({ offset: true }).nullable(),
  setBy: z.string().max(12).nullable(),
  setAt: z.iso.datetime({ offset: true }),
});

export type PauseSetting = z.infer<typeof pauseSettingSchema>;

export interface ActivePause {
  scope: "global" | "location";
  note: string | null;
  resumeAt: string | null;
}

function activePause(setting: PauseSetting | null): boolean {
  if (!setting?.paused) return false;
  if (setting.resumeAt && new Date(setting.resumeAt).getTime() <= Date.now()) return false;
  return true;
}

function toActive(setting: PauseSetting, scope: ActivePause["scope"]): ActivePause {
  return { scope, note: setting.note, resumeAt: setting.resumeAt };
}

/** Pure resolution, exported for tests: global pause wins, then the location's. */
export function resolvePause(
  global: PauseSetting | null,
  location: PauseSetting | null,
): ActivePause | null {
  if (activePause(global)) return toActive(global!, "global");
  if (activePause(location)) return toActive(location!, "location");
  return null;
}

/** Cached read for display surfaces (storefront banner). */
export async function getPauseState(locationId?: string | null): Promise<ActivePause | null> {
  const global = await getSettingCached(GLOBAL_PAUSE_KEY, pauseSettingSchema);
  const location = locationId
    ? await getSettingCached(pauseKeyForLocation(locationId), pauseSettingSchema)
    : null;
  return resolvePause(global, location);
}

/** Fresh read for enforcement — checkout must never trust a cache here. */
export async function getPauseStateFresh(locationId?: string | null): Promise<ActivePause | null> {
  const global = await getSettingFresh(GLOBAL_PAUSE_KEY, pauseSettingSchema);
  const location = locationId
    ? await getSettingFresh(pauseKeyForLocation(locationId), pauseSettingSchema)
    : null;
  return resolvePause(global, location);
}

export interface PauseOverview {
  global: PauseSetting | null;
  byLocation: Record<string, PauseSetting | null>;
}

/** Everything the staff toggle needs, in one query. */
export async function listPauseSettings(locationIds: readonly string[]): Promise<PauseOverview> {
  const map = await listSettingsByPrefixFresh(PAUSE_KEY_PREFIX, pauseSettingSchema);
  return {
    global: map.get(GLOBAL_PAUSE_KEY) ?? null,
    byLocation: Object.fromEntries(
      locationIds.map((id) => [id, map.get(pauseKeyForLocation(id)) ?? null]),
    ),
  };
}

export async function setOrderingPause(
  scope: "global" | { locationId: string },
  value: { paused: boolean; note: string | null; resumeAt: string | null; setBy: string | null },
): Promise<void> {
  const key = scope === "global" ? GLOBAL_PAUSE_KEY : pauseKeyForLocation(scope.locationId);
  await setSetting(key, pauseSettingSchema, { ...value, setAt: new Date().toISOString() });
}
