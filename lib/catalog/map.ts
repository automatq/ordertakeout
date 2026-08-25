import type { CatalogObject } from "square";

import { fromSquareAmount } from "@/lib/square/money";

import type {
  CatalogProduct,
  CatalogVariant,
  MappedCatalog,
  SkippedCatalogObject,
} from "./types";

/**
 * Map Square's catalog wire format into the domain model.
 *
 * Pure, so it can be tested against fixtures without credentials or a network.
 * That matters because this is where all of Square's optionality gets resolved,
 * and getting it wrong shows up as a product silently missing from the menu.
 *
 * Anything unsellable is reported in `skipped` rather than dropped on the floor.
 */
export function mapCatalogItems(
  objects: readonly CatalogObject[],
  options: { expectedCurrency?: string } = {},
): MappedCatalog {
  const expectedCurrency = options.expectedCurrency ?? "USD";
  const products: CatalogProduct[] = [];
  const skipped: SkippedCatalogObject[] = [];

  for (const object of objects) {
    if (object.type !== "ITEM") {
      // Categories are the one catalog object Square types without a required
      // id, so this can legitimately be null.
      skipped.push({ id: object.id ?? null, name: null, reason: "not_an_item" });
      continue;
    }

    const item = object.itemData;
    const name = item?.name?.trim();

    // Archived items still come back from the API but must not be sellable.
    if (item?.isArchived) {
      skipped.push({ id: object.id, name: name ?? null, reason: "archived" });
      continue;
    }

    if (!name) {
      skipped.push({ id: object.id, name: null, reason: "missing_name" });
      continue;
    }

    const variants: CatalogVariant[] = [];

    for (const variation of item?.variations ?? []) {
      if (variation.type !== "ITEM_VARIATION") continue;

      const data = variation.itemVariationData;
      const variantName = data?.name?.trim() || name;

      // Variable-price items have no amount to charge, so they can't be sold
      // online — the customer would have nothing to pay.
      if (data?.pricingType && data.pricingType !== "FIXED_PRICING") {
        skipped.push({
          id: variation.id,
          name: variantName,
          reason: "variation_not_fixed_price",
        });
        continue;
      }

      const amount = data?.priceMoney?.amount;
      if (amount == null) {
        skipped.push({
          id: variation.id,
          name: variantName,
          reason: "variation_missing_price",
        });
        continue;
      }

      const currency = data?.priceMoney?.currency ?? expectedCurrency;
      if (currency !== expectedCurrency) {
        skipped.push({
          id: variation.id,
          name: variantName,
          reason: "variation_currency_mismatch",
        });
        continue;
      }

      variants.push({
        id: variation.id,
        name: variantName,
        priceCents: fromSquareAmount(amount),
        currency,
        sku: data?.sku?.trim() || null,
        ordinal: data?.ordinal ?? 0,
      });
    }

    if (variants.length === 0) {
      skipped.push({ id: object.id, name, reason: "no_sellable_variants" });
      continue;
    }

    // Square's own ordering; ties broken by name so the menu is stable between
    // syncs rather than reshuffling on every deploy.
    variants.sort((a, b) => a.ordinal - b.ordinal || a.name.localeCompare(b.name));

    products.push({
      id: object.id,
      name,
      description: item?.description?.trim() || null,
      imageIds: item?.imageIds ?? [],
      // Resolved separately — see lib/catalog/images.ts. This module stays pure.
      imageUrls: [],
      /* reportingCategory is Square's own primary category and is what the
         Dashboard groups by, so it matches what staff see when they organise
         the catalog. categories[] is the multi-assignment list; its first entry
         is the fallback for items predating reporting categories. */
      categoryId: item?.reportingCategory?.id ?? item?.categories?.[0]?.id ?? null,
      categoryName: null,
      variants,
    });
  }

  return { products, skipped };
}

/** Look up a variant across a set of products, for cart and checkout validation. */
export function findVariant(
  products: readonly CatalogProduct[],
  variantId: string,
): { product: CatalogProduct; variant: CatalogVariant } | null {
  for (const product of products) {
    const variant = product.variants.find((v) => v.id === variantId);
    if (variant) return { product, variant };
  }
  return null;
}

/** Cheapest variant of a product, for "from $20" style listing copy. */
export function lowestPriceCents(product: CatalogProduct): number {
  return product.variants.reduce(
    (min, v) => Math.min(min, v.priceCents),
    Number.POSITIVE_INFINITY,
  );
}
