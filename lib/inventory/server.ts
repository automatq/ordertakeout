import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { isDemoMode } from "@/lib/demo/config";
import { squareClient } from "@/lib/square/client";
import { isInStockCount } from "./map";

export const INVENTORY_TAG = "square-inventory";

/**
 * Quantity available for each variation at one Square location.
 *
 * The storefront only renders available/sold-out, but checkout needs the actual
 * number. Reducing this to a Set caused a quantity-50 cart to pass whenever
 * Square reported even one unit.
 */
export async function getInventoryQuantities(
  locationId: string,
  variationIds: readonly string[],
): Promise<Map<string, number>> {
  return getCachedInventoryQuantities(locationId, [...new Set(variationIds)].sort());
}

async function getCachedInventoryQuantities(
  locationId: string,
  variationIds: string[],
): Promise<Map<string, number>> {
  "use cache";
  cacheLife("minutes");
  cacheTag(INVENTORY_TAG);
  return fetchInventoryQuantities(locationId, variationIds);
}

/** Bypass the browsing cache at the money boundary. */
export async function getFreshInventoryQuantities(
  locationId: string,
  variationIds: readonly string[],
): Promise<Map<string, number>> {
  return fetchInventoryQuantities(locationId, [...new Set(variationIds)]);
}

async function fetchInventoryQuantities(
  locationId: string,
  variationIds: readonly string[],
): Promise<Map<string, number>> {
  if (variationIds.length === 0) return new Map();
  if (isDemoMode()) {
    return new Map(variationIds.map((id) => {
      const soldOut =
        (locationId === "DEMO_LONDON" && id === "DEMO_VAR_HOPIA_90")
        || (locationId === "DEMO_TORONTO_SECOND" && id === "DEMO_VAR_UBE_BARS_BIG");
      return [id, soldOut ? 0 : 12];
    }));
  }

  const page = await squareClient().inventory.batchGetCounts({
    catalogObjectIds: [...variationIds],
    locationIds: [locationId],
    states: ["IN_STOCK"],
  });
  const quantities = new Map<string, number>();
  for await (const count of page) {
    if (!isInStockCount(count) || !count.catalogObjectId) continue;
    const quantity = Math.max(0, Math.floor(Number(count.quantity ?? "0")));
    quantities.set(count.catalogObjectId, (quantities.get(count.catalogObjectId) ?? 0) + quantity);
  }
  return quantities;
}

/** Returns variation IDs with a positive IN_STOCK count at this location. */
export async function getInStockVariationIds(
  locationId: string,
  variationIds: readonly string[],
): Promise<Set<string>> {
  const quantities = await getInventoryQuantities(locationId, variationIds);
  return new Set([...quantities].filter(([, quantity]) => quantity > 0).map(([id]) => id));
}
