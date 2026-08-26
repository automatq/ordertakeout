import "server-only";

import { z } from "zod";

import { DEFAULT_MAX_ORDERS_PER_SLOT } from "@/lib/store";

import { getSettingFresh, listSettingsByPrefixFresh, setSetting } from "./store";

/**
 * How many orders a pickup slot accepts by default.
 *
 * The limit counts *orders*, not items: it models how many customers the
 * counter can hand over to inside one pickup window. Per-product production
 * volume is a different constraint and is capped separately by
 * `products_config.max_units_per_day`.
 *
 * This used to be the hardcoded DEFAULT_MAX_ORDERS_PER_SLOT, whose own comment
 * said "Confirm with the store." At five orders an hour across five evening
 * slots that is twenty-five orders a day for the whole shop — plausible for
 * party trays, and far too low the moment everyday bread is orderable. Rather
 * than swap one guess for another, it is now a setting the bakery sets from
 * /staff/settings, per location, because the honest answer depends on how fast
 * their counter actually moves.
 */

const KEY_PREFIX = "capacity.slot-default.";
const GLOBAL_KEY = `${KEY_PREFIX}global`;

export const slotCapacityDefaultSchema = z.object({
  maxOrdersPerSlot: z.number().int().min(1).max(500),
});

export type SlotCapacityDefault = z.infer<typeof slotCapacityDefaultSchema>;

const keyFor = (locationId: string | null) =>
  locationId ? `${KEY_PREFIX}${locationId}` : GLOBAL_KEY;

/**
 * Resolve the default for one location.
 *
 * Location-specific beats global beats the compiled-in fallback, so a shop can
 * set one number for the chain and override the busy branch. Read fresh: this
 * decides whether an order can be placed, and the settings module's own rule is
 * cached for display, fresh for enforcement.
 */
export async function getSlotCapacityDefault(locationId?: string | null): Promise<number> {
  if (locationId) {
    const specific = await getSettingFresh(keyFor(locationId), slotCapacityDefaultSchema);
    if (specific) return specific.maxOrdersPerSlot;
  }
  const global = await getSettingFresh(GLOBAL_KEY, slotCapacityDefaultSchema);
  return global?.maxOrdersPerSlot ?? DEFAULT_MAX_ORDERS_PER_SLOT;
}

export async function setSlotCapacityDefault(
  locationId: string | null,
  maxOrdersPerSlot: number,
): Promise<void> {
  await setSetting(keyFor(locationId), slotCapacityDefaultSchema, { maxOrdersPerSlot });
}

export interface SlotCapacityDefaultRow {
  /** Null for the value that applies to every location without its own. */
  locationId: string | null;
  maxOrdersPerSlot: number;
}

/** Every configured default, for the settings screen. */
export async function listSlotCapacityDefaults(): Promise<SlotCapacityDefaultRow[]> {
  const rows = await listSettingsByPrefixFresh(KEY_PREFIX, slotCapacityDefaultSchema);
  return [...rows.entries()].map(([key, value]) => ({
    locationId: key === GLOBAL_KEY ? null : key.slice(KEY_PREFIX.length),
    maxOrdersPerSlot: value.maxOrdersPerSlot,
  }));
}

/** The compiled-in fallback, shown as the effective value when nothing is set. */
export const FALLBACK_SLOT_CAPACITY = DEFAULT_MAX_ORDERS_PER_SLOT;
