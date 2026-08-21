import { describe, expect, it } from "vitest";

import {
  cartSnapshotsMatch,
  normalizeCart,
  resolveCart,
  retainCartVariants,
  subtractCartItems,
  toSchedulingCart,
} from "./cart";
import type { CatalogProduct } from "./types";

const ENSAYMADA: CatalogProduct = {
  id: "ITEM_ENSAYMADA",
  name: "Ensaymada Party Tray",
  description: null,
  imageIds: [],
  imageUrls: [],
  variants: [
    { id: "VAR_25_UBE", name: "25 pcs Ube", priceCents: 2500, currency: "USD", sku: null, ordinal: 0 },
    { id: "VAR_56_CHEESE", name: "56 pcs Cheese", priceCents: 4000, currency: "USD", sku: null, ordinal: 1 },
  ],
};

const HOPIA: CatalogProduct = {
  id: "ITEM_HOPIA",
  name: "Hopia Ube / Hopia Baboy",
  description: null,
  imageIds: [],
  imageUrls: [],
  variants: [
    { id: "VAR_HOPIA_60", name: "60 pcs", priceCents: 4500, currency: "USD", sku: null, ordinal: 0 },
  ],
};

const CATALOG = [ENSAYMADA, HOPIA];

describe("resolveCart", () => {
  it("prices lines from the catalog, not from the request", () => {
    const result = resolveCart([{ variantId: "VAR_25_UBE", quantity: 2 }], CATALOG);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.lines[0]?.lineTotalCents).toBe(5000);
    expect(result.subtotalCents).toBe(5000);
    expect(result.currency).toBe("USD");
  });

  it("totals a multi-line cart", () => {
    const result = resolveCart(
      [
        { variantId: "VAR_25_UBE", quantity: 2 }, // 5000
        { variantId: "VAR_56_CHEESE", quantity: 1 }, // 4000
        { variantId: "VAR_HOPIA_60", quantity: 3 }, // 13500
      ],
      CATALOG,
    );
    expect(result.ok && result.subtotalCents).toBe(22500);
  });

  it("rejects a cart referencing a variant that is no longer sold", () => {
    // The realistic path: staff archive an item in Square while a cart is open.
    const result = resolveCart(
      [
        { variantId: "VAR_25_UBE", quantity: 1 },
        { variantId: "VAR_DELETED", quantity: 1 },
      ],
      CATALOG,
    );
    expect(result).toMatchObject({
      ok: false,
      unknownVariantIds: ["VAR_DELETED"],
      subtotalCents: 2500,
      currency: "USD",
    });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.variant.id).toBe("VAR_25_UBE");
  });

  it("resolves an empty cart to a zero subtotal rather than failing", () => {
    const result = resolveCart([], CATALOG);
    expect(result).toMatchObject({ ok: true, subtotalCents: 0, lines: [] });
  });
});

describe("toSchedulingCart", () => {
  it("collapses variants of one product into a single production line", () => {
    // Two Ensaymada tray sizes draw on the same daily oven capacity, so the
    // scheduling engine must see 3 Ensaymada trays, not 2 + 1 separately.
    const resolved = resolveCart(
      [
        { variantId: "VAR_25_UBE", quantity: 2 },
        { variantId: "VAR_56_CHEESE", quantity: 1 },
      ],
      CATALOG,
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    expect(toSchedulingCart(resolved.lines)).toEqual([
      { productId: "ITEM_ENSAYMADA", quantity: 3 },
    ]);
  });

  it("keeps distinct products separate", () => {
    const resolved = resolveCart(
      [
        { variantId: "VAR_25_UBE", quantity: 1 },
        { variantId: "VAR_HOPIA_60", quantity: 2 },
      ],
      CATALOG,
    );
    if (!resolved.ok) throw new Error("expected resolution");

    expect(toSchedulingCart(resolved.lines)).toEqual([
      { productId: "ITEM_ENSAYMADA", quantity: 1 },
      { productId: "ITEM_HOPIA", quantity: 2 },
    ]);
  });

  it("returns nothing for an empty cart", () => {
    expect(toSchedulingCart([])).toEqual([]);
  });
});

describe("normalizeCart", () => {
  it("merges repeated additions of the same variant", () => {
    expect(
      normalizeCart([
        { variantId: "VAR_25_UBE", quantity: 1 },
        { variantId: "VAR_25_UBE", quantity: 2 },
      ]),
    ).toEqual([{ variantId: "VAR_25_UBE", quantity: 3 }]);
  });

  it("drops lines reduced to zero or below", () => {
    expect(
      normalizeCart([
        { variantId: "VAR_25_UBE", quantity: 2 },
        { variantId: "VAR_25_UBE", quantity: -2 },
        { variantId: "VAR_HOPIA_60", quantity: 1 },
      ]),
    ).toEqual([{ variantId: "VAR_HOPIA_60", quantity: 1 }]);
  });
});

describe("retainCartVariants", () => {
  it("removes unavailable items when the pickup location changes", () => {
    expect(
      retainCartVariants(
        [
          { variantId: "VAR_25_UBE", quantity: 2 },
          { variantId: "VAR_HOPIA_60", quantity: 1 },
        ],
        ["VAR_HOPIA_60"],
      ),
    ).toEqual([{ variantId: "VAR_HOPIA_60", quantity: 1 }]);
  });

  it("normalizes retained quantities instead of reviving removed lines", () => {
    expect(
      retainCartVariants(
        [
          { variantId: "VAR_25_UBE", quantity: 1 },
          { variantId: "VAR_25_UBE", quantity: 2 },
          { variantId: "VAR_HOPIA_60", quantity: 1 },
        ],
        ["VAR_25_UBE"],
      ),
    ).toEqual([{ variantId: "VAR_25_UBE", quantity: 3 }]);
  });
});

describe("cartSnapshotsMatch", () => {
  it("accepts the same normalized cart regardless of line order", () => {
    expect(cartSnapshotsMatch(
      [
        { variantId: "VAR_HOPIA_60", quantity: 1 },
        { variantId: "VAR_25_UBE", quantity: 2 },
      ],
      [
        { variantId: "VAR_25_UBE", quantity: 1 },
        { variantId: "VAR_25_UBE", quantity: 1 },
        { variantId: "VAR_HOPIA_60", quantity: 1 },
      ],
    )).toBe(true);
  });

  it("rejects a newly added line while location inventory is being checked", () => {
    expect(cartSnapshotsMatch(
      [{ variantId: "VAR_25_UBE", quantity: 1 }],
      [
        { variantId: "VAR_25_UBE", quantity: 1 },
        { variantId: "VAR_HOPIA_60", quantity: 1 },
      ],
    )).toBe(false);
  });

  it("rejects a quantity increase while location inventory is being checked", () => {
    expect(cartSnapshotsMatch(
      [{ variantId: "VAR_25_UBE", quantity: 1 }],
      [{ variantId: "VAR_25_UBE", quantity: 2 }],
    )).toBe(false);
  });
});

describe("subtractCartItems", () => {
  it("empties an unchanged cart after payment", () => {
    const cart = [{ variantId: "VAR_25_UBE", quantity: 2 }];
    expect(subtractCartItems(cart, cart)).toEqual([]);
  });

  it("preserves items and extra quantities added from another tab", () => {
    expect(subtractCartItems(
      [
        { variantId: "VAR_25_UBE", quantity: 3 },
        { variantId: "VAR_HOPIA_60", quantity: 1 },
      ],
      [{ variantId: "VAR_25_UBE", quantity: 2 }],
    )).toEqual([
      { variantId: "VAR_25_UBE", quantity: 1 },
      { variantId: "VAR_HOPIA_60", quantity: 1 },
    ]);
  });
});
