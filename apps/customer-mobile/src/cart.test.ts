import { describe, expect, it } from "vitest";

import { addLine, removeLine, resolveCart, setQuantity, type CartLine } from "./cart";
import type { MenuProduct } from "./api";

const variant = (id: string, priceCents: number) => ({
  id,
  name: id,
  priceCents,
  currency: "CAD",
  available: true as boolean | null,
});

const MENU: MenuProduct[] = [
  {
    id: "tray",
    slug: "tray",
    name: "Ensaymada Party Tray",
    description: null,
    imageUrl: null,
    allergens: [],
    dietaryTags: [],
    leadTimeDays: 1,
    orderCutoffTime: "18:00",
    variants: [variant("small", 2000), variant("big", 5000)],
  },
];

describe("resolveCart", () => {
  it("totals each line and the order", () => {
    const cart: CartLine[] = [
      { productId: "tray", variantId: "small", quantity: 2 },
      { productId: "tray", variantId: "big", quantity: 1 },
    ];
    const totals = resolveCart(cart, MENU);
    expect(totals.itemCount).toBe(3);
    expect(totals.subtotalCents).toBe(2000 * 2 + 5000);
    expect(totals.lines[0]!.totalCents).toBe(4000);
  });

  it("drops a size that is no longer on the menu, and says how many", () => {
    /* Silently is fine; invisibly is not. A total that changes by itself with
       no explanation is worse than the item disappearing. */
    const totals = resolveCart(
      [
        { productId: "tray", variantId: "small", quantity: 1 },
        { productId: "tray", variantId: "withdrawn", quantity: 1 },
        { productId: "gone", variantId: "x", quantity: 1 },
      ],
      MENU,
    );
    expect(totals.lines).toHaveLength(1);
    expect(totals.droppedCount).toBe(2);
    expect(totals.subtotalCents).toBe(2000);
  });

  it("takes the currency from the cart rather than assuming", () => {
    const totals = resolveCart([{ productId: "tray", variantId: "small", quantity: 1 }], MENU);
    expect(totals.currency).toBe("CAD");
  });

  it("is empty for an empty cart without touching the menu", () => {
    expect(resolveCart([], MENU)).toMatchObject({ itemCount: 0, subtotalCents: 0 });
  });
});

describe("addLine", () => {
  it("merges with an existing line for the same size", () => {
    // Two lines that happen to be identical is how somebody deletes one and is
    // surprised by what is left.
    const cart = addLine([{ productId: "tray", variantId: "small", quantity: 1 }], "tray", "small", 2);
    expect(cart).toEqual([{ productId: "tray", variantId: "small", quantity: 3 }]);
  });

  it("keeps different sizes of the same product apart", () => {
    const cart = addLine([{ productId: "tray", variantId: "small", quantity: 1 }], "tray", "big", 1);
    expect(cart).toHaveLength(2);
  });
});

describe("setQuantity", () => {
  it("never goes below one, because removing is its own action", () => {
    const cart = setQuantity([{ productId: "tray", variantId: "small", quantity: 1 }], 0, 0);
    expect(cart[0]!.quantity).toBe(1);
  });
});

describe("removeLine", () => {
  it("removes only the line asked for", () => {
    const cart: CartLine[] = [
      { productId: "tray", variantId: "small", quantity: 1 },
      { productId: "tray", variantId: "big", quantity: 1 },
    ];
    expect(removeLine(cart, 0)).toEqual([cart[1]]);
  });
});
