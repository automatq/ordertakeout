import { describe, expect, it } from "vitest";

import { inventoryShortages, isInStockCount } from "./map";

describe("isInStockCount", () => {
  it("treats only positive location inventory as available", () => {
    expect(isInStockCount({ catalogObjectId: "VAR", quantity: "1" })).toBe(true);
    expect(isInStockCount({ catalogObjectId: "VAR", quantity: "0" })).toBe(false);
    expect(isInStockCount({ catalogObjectId: "VAR", quantity: "-2" })).toBe(false);
    expect(isInStockCount({ quantity: "4" })).toBe(false);
  });
});

describe("inventoryShortages", () => {
  it("compares requested quantities instead of treating any stock as enough", () => {
    const shortages = inventoryShortages(
      [
        { variationId: "ONE", quantity: 2 },
        { variationId: "MANY", quantity: 3 },
        { variationId: "MISSING", quantity: 1 },
      ],
      new Map([
        ["ONE", 1],
        ["MANY", 9],
      ]),
    );

    expect(shortages).toEqual([
      { variationId: "ONE", quantity: 2, available: 1 },
      { variationId: "MISSING", quantity: 1, available: 0 },
    ]);
  });
});
