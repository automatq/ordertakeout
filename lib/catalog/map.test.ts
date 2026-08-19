import type { CatalogObject } from "square";
import { describe, expect, it } from "vitest";

import { findVariant, lowestPriceCents, mapCatalogItems } from "./map";

/* -------------------------------------------------------------------------- */
/* Fixtures modelled on the eight real SKUs from the requirements document.    */
/* -------------------------------------------------------------------------- */

type VariationSpec = {
  id: string;
  name: string;
  cents?: number | null;
  currency?: string;
  pricingType?: "FIXED_PRICING" | "VARIABLE_PRICING";
  ordinal?: number;
  sku?: string;
};

function variation(spec: VariationSpec): CatalogObject {
  return {
    type: "ITEM_VARIATION",
    id: spec.id,
    itemVariationData: {
      name: spec.name,
      sku: spec.sku,
      ordinal: spec.ordinal,
      pricingType: spec.pricingType ?? "FIXED_PRICING",
      priceMoney:
        spec.cents == null
          ? undefined
          : { amount: BigInt(spec.cents), currency: (spec.currency ?? "USD") as "USD" },
    },
  } as CatalogObject;
}

function item(
  id: string,
  name: string,
  variations: CatalogObject[],
  extra: { archived?: boolean; description?: string; imageIds?: string[] } = {},
): CatalogObject {
  return {
    type: "ITEM",
    id,
    itemData: {
      name,
      description: extra.description,
      imageIds: extra.imageIds,
      isArchived: extra.archived,
      variations,
    },
  } as CatalogObject;
}

const ENSAYMADA = item("ITEM_ENSAYMADA", "Ensaymada Party Tray", [
  variation({ id: "VAR_25_UBE", name: "25 pcs Ube", cents: 2500, ordinal: 0 }),
  variation({ id: "VAR_25_CHEESE", name: "25 pcs Cheese", cents: 2000, ordinal: 1 }),
  variation({ id: "VAR_56_UBE", name: "56 pcs Ube", cents: 5000, ordinal: 2 }),
  variation({ id: "VAR_56_CHEESE", name: "56 pcs Cheese", cents: 4000, ordinal: 3 }),
]);

const HOPIA = item("ITEM_HOPIA", "Hopia Ube / Hopia Baboy", [
  variation({ id: "VAR_HOPIA_60", name: "60 pcs", cents: 4500, ordinal: 0 }),
  variation({ id: "VAR_HOPIA_90", name: "90 pcs", cents: 6500, ordinal: 1 }),
]);

const UBE_BARS = item("ITEM_UBE_BARS", "Ube Bars", [
  variation({ id: "VAR_BARS_BIG", name: "Big - 78 pcs", cents: 5000, ordinal: 0 }),
  variation({ id: "VAR_BARS_SMALL", name: "Small - 48 pcs", cents: 3000, ordinal: 1 }),
]);

const FULL_CATALOG = [ENSAYMADA, HOPIA, UBE_BARS];

/* -------------------------------------------------------------------------- */

describe("mapCatalogItems", () => {
  it("maps the store's three product lines and eight sellable variants", () => {
    const { products, skipped } = mapCatalogItems(FULL_CATALOG);

    expect(products).toHaveLength(3);
    expect(products.flatMap((p) => p.variants)).toHaveLength(8);
    expect(skipped).toEqual([]);
  });

  it("converts Square's bigint cents to plain numbers", () => {
    const { products } = mapCatalogItems([ENSAYMADA]);
    const prices = products[0]?.variants.map((v) => v.priceCents);
    expect(prices).toEqual([2500, 2000, 5000, 4000]);
    expect(prices?.every((p) => typeof p === "number")).toBe(true);
  });

  it("orders variants by Square's ordinal so the menu is stable between syncs", () => {
    const shuffled = item("ITEM_X", "Shuffled", [
      variation({ id: "C", name: "Third", cents: 300, ordinal: 2 }),
      variation({ id: "A", name: "First", cents: 100, ordinal: 0 }),
      variation({ id: "B", name: "Second", cents: 200, ordinal: 1 }),
    ]);
    const { products } = mapCatalogItems([shuffled]);
    expect(products[0]?.variants.map((v) => v.id)).toEqual(["A", "B", "C"]);
  });

  it("breaks ordinal ties by name rather than leaving order to chance", () => {
    const tied = item("ITEM_Y", "Tied", [
      variation({ id: "Z", name: "Zucchini", cents: 100, ordinal: 0 }),
      variation({ id: "A", name: "Apple", cents: 100, ordinal: 0 }),
    ]);
    const { products } = mapCatalogItems([tied]);
    expect(products[0]?.variants.map((v) => v.name)).toEqual(["Apple", "Zucchini"]);
  });

  it("carries description and images through", () => {
    const withMedia = item(
      "ITEM_M",
      "With Media",
      [variation({ id: "V", name: "One", cents: 100 })],
      { description: "  Soft and buttery  ", imageIds: ["IMG_1", "IMG_2"] },
    );
    const { products } = mapCatalogItems([withMedia]);
    expect(products[0]?.description).toBe("Soft and buttery");
    expect(products[0]?.imageIds).toEqual(["IMG_1", "IMG_2"]);
  });

  it("falls back to the item name when a variation has none", () => {
    const single = item("ITEM_S", "Single Variant Product", [
      variation({ id: "V", name: "", cents: 100 }),
    ]);
    const { products } = mapCatalogItems([single]);
    expect(products[0]?.variants[0]?.name).toBe("Single Variant Product");
  });
});

describe("mapCatalogItems — things that must not reach the storefront", () => {
  it("skips archived items", () => {
    const archived = item("ITEM_OLD", "Discontinued Tray", [
      variation({ id: "V", name: "One", cents: 100 }),
    ], { archived: true });

    const { products, skipped } = mapCatalogItems([...FULL_CATALOG, archived]);
    expect(products).toHaveLength(3);
    expect(skipped).toContainEqual({
      id: "ITEM_OLD",
      name: "Discontinued Tray",
      reason: "archived",
    });
  });

  it("skips variable-price variations, which have nothing to charge", () => {
    const variable = item("ITEM_V", "Custom Cake", [
      variation({ id: "VAR_CUSTOM", name: "Made to order", pricingType: "VARIABLE_PRICING" }),
    ]);
    const { products, skipped } = mapCatalogItems([variable]);

    expect(products).toHaveLength(0);
    expect(skipped.map((s) => s.reason)).toEqual([
      "variation_not_fixed_price",
      "no_sellable_variants",
    ]);
  });

  it("skips variations with no price at all", () => {
    const priceless = item("ITEM_P", "Priceless", [
      variation({ id: "VAR_NP", name: "No price", cents: null }),
    ]);
    const { skipped } = mapCatalogItems([priceless]);
    expect(skipped[0]).toMatchObject({ id: "VAR_NP", reason: "variation_missing_price" });
  });

  it("skips variations priced in an unexpected currency", () => {
    const foreign = item("ITEM_F", "Foreign", [
      variation({ id: "VAR_CAD", name: "Canadian", cents: 100, currency: "CAD" }),
    ]);
    const { skipped } = mapCatalogItems([foreign]);
    expect(skipped[0]).toMatchObject({
      id: "VAR_CAD",
      reason: "variation_currency_mismatch",
    });
  });

  it("keeps the sellable variants of an item that has some bad ones", () => {
    const mixed = item("ITEM_MIX", "Mixed", [
      variation({ id: "GOOD", name: "Good", cents: 1000, ordinal: 0 }),
      variation({ id: "BAD", name: "Bad", pricingType: "VARIABLE_PRICING", ordinal: 1 }),
    ]);
    const { products, skipped } = mapCatalogItems([mixed]);

    expect(products[0]?.variants.map((v) => v.id)).toEqual(["GOOD"]);
    expect(skipped).toHaveLength(1);
  });

  it("skips items with no name", () => {
    const nameless = item("ITEM_N", "   ", [variation({ id: "V", name: "One", cents: 100 })]);
    const { products, skipped } = mapCatalogItems([nameless]);
    expect(products).toHaveLength(0);
    expect(skipped[0]?.reason).toBe("missing_name");
  });

  it("skips non-item catalog objects such as taxes and categories", () => {
    const tax = { type: "TAX", id: "TAX_1", taxData: { name: "Sales Tax" } } as CatalogObject;
    const { products, skipped } = mapCatalogItems([ENSAYMADA, tax]);
    expect(products).toHaveLength(1);
    expect(skipped).toContainEqual({ id: "TAX_1", name: null, reason: "not_an_item" });
  });

  it("reports skips rather than silently shortening the menu", () => {
    // The whole point: a sync that drops products should be visible to staff.
    const { skipped } = mapCatalogItems([
      item("ITEM_A", "Gone", [variation({ id: "VA", name: "x", cents: null })]),
    ]);
    expect(skipped.length).toBeGreaterThan(0);
  });

  it("handles an empty catalog without throwing", () => {
    expect(mapCatalogItems([])).toEqual({ products: [], skipped: [] });
  });
});

describe("findVariant", () => {
  const { products } = mapCatalogItems(FULL_CATALOG);

  it("finds a variant and its parent product", () => {
    const found = findVariant(products, "VAR_56_UBE");
    expect(found?.product.id).toBe("ITEM_ENSAYMADA");
    expect(found?.variant.priceCents).toBe(5000);
  });

  it("returns null for an unknown variant", () => {
    expect(findVariant(products, "NOPE")).toBeNull();
  });
});

describe("lowestPriceCents", () => {
  it("reports the cheapest variant for 'from' pricing", () => {
    const { products } = mapCatalogItems([ENSAYMADA]);
    expect(lowestPriceCents(products[0]!)).toBe(2000);
  });
});
