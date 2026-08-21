import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { isDemoMode } from "@/lib/demo/config";
import { squareClient } from "@/lib/square/client";

import { isInStockCount } from "./map";

export const INVENTORY_TAG = "square-inventory";

/**
 * Cached raw Square counts used while a customer browses.
 *
 * Local reservation state must never enter this cache. The public inventory
 * facade subtracts live database holds only after this function returns.
 */
export async function getCachedRawInventoryQuantities(
  locationId: string,
  variationIds: readonly string[],
): Promise<Map<string, number>> {
  return getCachedRawInventoryQuantitiesCanonical(
    locationId,
    [...new Set(variationIds)].sort(),
  );
}

async function getCachedRawInventoryQuantitiesCanonical(
  locationId: string,
  variationIds: string[],
): Promise<Map<string, number>> {
  "use cache";
  cacheLife("minutes");
  cacheTag(INVENTORY_TAG);
  return fetchRawInventoryQuantities(locationId, variationIds);
}

/** Raw Square counts bypassing the browsing cache at the money boundary. */
export async function getFreshRawInventoryQuantities(
  locationId: string,
  variationIds: readonly string[],
): Promise<Map<string, number>> {
  return fetchRawInventoryQuantities(locationId, [...new Set(variationIds)].sort());
}

async function fetchRawInventoryQuantities(
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
