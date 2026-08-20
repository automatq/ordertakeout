"use server";

import { z } from "zod";

import { getInStockVariationIds, getInventoryQuantities } from "@/lib/inventory/server";
import { getStoreLocation, getStoreLocations } from "@/lib/locations/server";
import { consumeRateLimit, requestFingerprint } from "@/lib/security/rate-limit";
import { getOrderableProducts } from "@/lib/catalog/server";
import { normalizeCart, resolveCart } from "@/lib/catalog/cart";
import { inventoryShortages } from "@/lib/inventory/map";

export async function getPickupLocations() {
  const limit = await consumeRateLimit("pickup-locations", await requestFingerprint(), {
    attempts: 30,
    windowMs: 60_000,
  });
  if (!limit.allowed) return [];
  return getStoreLocations();
}

export async function getVariantAvailability(input: unknown): Promise<Record<string, boolean>> {
  const parsed = z.object({ locationId: z.string().min(1), variantIds: z.array(z.string().min(1)).max(100) }).safeParse(input);
  if (!parsed.success || !(await getStoreLocation(parsed.data.locationId))) return {};
  const limit = await consumeRateLimit("inventory", await requestFingerprint(parsed.data.locationId), {
    attempts: 60,
    windowMs: 60_000,
  });
  if (!limit.allowed) return {};
  const inStock = await getInStockVariationIds(parsed.data.locationId, parsed.data.variantIds);
  return Object.fromEntries(parsed.data.variantIds.map((id) => [id, inStock.has(id)]));
}

export async function getVariantInventory(input: unknown): Promise<Record<string, number>> {
  const parsed = z.object({ locationId: z.string().min(1), variantIds: z.array(z.string().min(1)).max(100) }).safeParse(input);
  if (!parsed.success || !(await getStoreLocation(parsed.data.locationId))) return {};
  const limit = await consumeRateLimit("inventory", await requestFingerprint(parsed.data.locationId), {
    attempts: 60,
    windowMs: 60_000,
  });
  if (!limit.allowed) return {};
  const quantities = await getInventoryQuantities(parsed.data.locationId, parsed.data.variantIds);
  return Object.fromEntries(parsed.data.variantIds.map((id) => [id, quantities.get(id) ?? 0]));
}

export interface CartReconciliation {
  retainedVariantIds: string[];
  removed: {
    variantId: string;
    name: string;
    requested: number;
    available: number;
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
  const limit = await consumeRateLimit("inventory", await requestFingerprint(parsed.data.locationId), {
    attempts: 60,
    windowMs: 60_000,
  });
  if (!limit.allowed) return null;

  const catalog = await getOrderableProducts();
  if (catalog.error) return null;
  const items = normalizeCart(parsed.data.items);
  const resolved = resolveCart(items, catalog.products);
  if (!resolved.ok) {
    return {
      retainedVariantIds: items
        .filter((item) => !resolved.unknownVariantIds.includes(item.variantId))
        .map((item) => item.variantId),
      removed: resolved.unknownVariantIds.map((variantId) => ({
        variantId,
        name: "Unavailable item",
        requested: items.find((item) => item.variantId === variantId)?.quantity ?? 1,
        available: 0,
      })),
    };
  }
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
    removed: resolved.lines.flatMap((line) => {
      const shortage = shortageById.get(line.variant.id);
      return shortage ? [{
        variantId: line.variant.id,
        name: `${line.product.name} — ${line.variant.name}`,
        requested: line.quantity,
        available: shortage.available,
      }] : [];
    }),
  };
}
