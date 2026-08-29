import "server-only";

import {
  subtractActiveInventoryHolds,
  type InventoryHoldReadOptions,
} from "./reservations";
import {
  getCachedRawInventoryQuantities,
  getFreshRawInventoryQuantities as loadFreshRawInventoryQuantities,
  INVENTORY_TAG,
} from "./raw";

export { INVENTORY_TAG };
export { fetchTrackedVariationIds } from "./raw";

/**
 * Location inventory visible to a customer.
 *
 * Only Square's raw count is cached. Active local reservations are read and
 * subtracted on every call, preventing an old cache entry from making a unit
 * held by another checkout appear purchasable.
 */
export async function getInventoryQuantities(
  locationId: string,
  variationIds: readonly string[],
  options: InventoryHoldReadOptions = {},
): Promise<Map<string, number>> {
  const raw = await getCachedRawInventoryQuantities(locationId, variationIds);
  return subtractActiveInventoryHolds(locationId, raw, options);
}

/** Caller-facing raw snapshot for the transactional reservation boundary. */
export async function getFreshRawInventoryQuantities(
  locationId: string,
  variationIds: readonly string[],
): Promise<Map<string, number>> {
  return loadFreshRawInventoryQuantities(locationId, variationIds);
}

/**
 * Fresh Square counts with active local reservations subtracted.
 *
 * Pass `excludeOrderId` immediately before charging so the order's own hold is
 * not counted against itself while every competing checkout still is.
 */
export async function getFreshInventoryQuantities(
  locationId: string,
  variationIds: readonly string[],
  options: InventoryHoldReadOptions = {},
): Promise<Map<string, number>> {
  const raw = await loadFreshRawInventoryQuantities(locationId, variationIds);
  return subtractActiveInventoryHolds(locationId, raw, options);
}

/** Returns variation IDs with positive net inventory at this location. */
export async function getInStockVariationIds(
  locationId: string,
  variationIds: readonly string[],
  options: InventoryHoldReadOptions = {},
): Promise<Set<string>> {
  const quantities = await getInventoryQuantities(locationId, variationIds, options);
  return new Set([...quantities].filter(([, quantity]) => quantity > 0).map(([id]) => id));
}
