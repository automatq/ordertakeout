"use server";

import { z } from "zod";

import { getInStockVariationIds, getInventoryQuantities } from "@/lib/inventory/server";
import { getStoreLocation, getStoreLocations } from "@/lib/locations/server";
import { consumeRateLimit, requestFingerprint } from "@/lib/security/rate-limit";
import { getOrderableProducts } from "@/lib/catalog/server";
import { normalizeCart, resolveCart } from "@/lib/catalog/cart";
import { inventoryShortages, VARIANT_AVAILABILITY_LIMIT } from "@/lib/inventory/map";

export type PickupLocationsResult =
  | { ok: true; locations: Awaited<ReturnType<typeof getStoreLocations>> }
  | { ok: false };

export async function getPickupLocations(): Promise<PickupLocationsResult> {
  const limit = await consumeRateLimit("pickup-locations", await requestFingerprint(), {
    attempts: 30,
    windowMs: 60_000,
  });
  if (!limit.allowed) return { ok: false };
  try {
    return { ok: true, locations: await getStoreLocations() };
  } catch {
    return { ok: false };
  }
}

export type VariantAvailabilityResult =
  | { ok: true; values: Record<string, boolean> }
  | { ok: false };

export async function getVariantAvailability(input: unknown): Promise<VariantAvailabilityResult> {
  const parsed = z.object({
    locationId: z.string().min(1),
    variantIds: z.array(z.string().min(1)).max(VARIANT_AVAILABILITY_LIMIT),
  }).safeParse(input);
  if (!parsed.success || !(await getStoreLocation(parsed.data.locationId))) return { ok: false };
  const limit = await consumeRateLimit("inventory", await requestFingerprint(), {
    attempts: 60,
    windowMs: 60_000,
  });
  if (!limit.allowed) return { ok: false };
  const inStock = await getInStockVariationIds(parsed.data.locationId, parsed.data.variantIds);
  return {
    ok: true,
    values: Object.fromEntries(parsed.data.variantIds.map((id) => [id, inStock.has(id)])),
  };
}

export interface CartReconciliation {
  retainedVariantIds: string[];
  removed: {
    variantId: string;
    name: string;
    reason: "unavailable" | "insufficient";
  }[];
}

export async function reconcileCartForLocation(input: unknown): Promise<CartReconciliation | null> {
  const parsed = z.object({
    locationId: z.string().min(1),
    items: z.array(z.object({
      variantId: z.string().min(1),
      quantity: z.number().int().min(1).max(50),
    })).max(30),
  }).safeParse(input);
  if (!parsed.success || !(await getStoreLocation(parsed.data.locationId))) return null;
  const limit = await consumeRateLimit("inventory", await requestFingerprint(), {
    attempts: 60,
    windowMs: 60_000,
  });
  if (!limit.allowed) return null;

  const catalog = await getOrderableProducts();
  if (catalog.error) return null;
  const items = normalizeCart(parsed.data.items);
  const resolved = resolveCart(items, catalog.products);
  const inventory = await getInventoryQuantities(
    parsed.data.locationId,
    resolved.lines.map((line) => line.variant.id),
  );
  const shortages = inventoryShortages(
    resolved.lines.map((line) => ({ variationId: line.variant.id, quantity: line.quantity })),
    inventory,
  );
  const shortageById = new Map(shortages.map((shortage) => [shortage.variationId, shortage]));
  return {
    retainedVariantIds: resolved.lines
      .filter((line) => !shortageById.has(line.variant.id))
      .map((line) => line.variant.id),
    removed: [
      ...(!resolved.ok ? resolved.unknownVariantIds.map((variantId) => ({
        variantId,
        name: "Unavailable item",
        reason: "unavailable" as const,
      })) : []),
      ...resolved.lines.flatMap((line) => {
        const shortage = shortageById.get(line.variant.id);
        return shortage ? [{
          variantId: line.variant.id,
          name: `${line.product.name} — ${line.variant.name}`,
          reason: "insufficient" as const,
        }] : [];
      }),
    ],
  };
}
