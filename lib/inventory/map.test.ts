import { describe, expect, it } from "vitest";

import { VARIANT_AVAILABILITY_LIMIT, availableInventoryAfterHolds, inventoryShortages, isInStockCount, normalizeInventoryRequests, variantAvailabilityBatches } from "./map";

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

  it("combines duplicate variation lines before comparing availability", () => {
    expect(inventoryShortages(
      [
        { variationId: "SAME", quantity: 2 },
        { variationId: "SAME", quantity: 2 },
      ],
      new Map([["SAME", 3]]),
    )).toEqual([
      { variationId: "SAME", quantity: 4, available: 3 },
    ]);
  });
});

describe("normalizeInventoryRequests", () => {
  it("aggregates duplicate lines while retaining presentation order", () => {
    expect(normalizeInventoryRequests([
      { variationId: "VAR-Z", quantity: 1 },
      { variationId: "VAR-A", quantity: 2 },
      { variationId: "VAR-Z", quantity: 3 },
    ])).toEqual([
      { variationId: "VAR-Z", quantity: 4 },
      { variationId: "VAR-A", quantity: 2 },
    ]);
  });

  it("rejects invalid hold quantities instead of silently rounding them", () => {
    expect(() => normalizeInventoryRequests([{ variationId: "VAR", quantity: 0 }]))
      .toThrow(RangeError);
    expect(() => normalizeInventoryRequests([{ variationId: "VAR", quantity: 1.5 }]))
      .toThrow(RangeError);
  });
});

describe("availableInventoryAfterHolds", () => {
  it("subtracts local holds from raw Square counts without going negative", () => {
    expect([...availableInventoryAfterHolds(
      new Map([
        ["LOW", 2],
        ["OPEN", 8],
      ]),
      new Map([
        ["LOW", 5],
        ["OPEN", 3],
        ["MISSING", 1],
      ]),
    )]).toEqual([
      ["LOW", 0],
      ["OPEN", 5],
      ["MISSING", 0],
    ]);
  });
});

describe("variantAvailabilityBatches", () => {
  const ids = (count: number) => Array.from({ length: count }, (_, i) => `V${i}`);

  it("sends one request for a catalog inside the limit", () => {
    expect(variantAvailabilityBatches(ids(VARIANT_AVAILABILITY_LIMIT))).toHaveLength(1);
    expect(variantAvailabilityBatches([])).toEqual([]);
  });

  it("splits a catalog past the limit instead of failing the request", () => {
    // Regression: the grid sent every variant on the page in one call while the
    // action capped the array. Past the cap the parse failed, availability came
    // back unknown, and every product rendered as in stock until checkout.
    expect(variantAvailabilityBatches(ids(VARIANT_AVAILABILITY_LIMIT + 1))).toHaveLength(2);
    expect(variantAvailabilityBatches(ids(500))).toHaveLength(3);
  });

  it("preserves every id exactly once across batches", () => {
    const input = ids(453);
    const flattened = variantAvailabilityBatches(input).flat();
    expect(flattened).toEqual(input);
    expect(new Set(flattened).size).toBe(input.length);
  });

  it("never emits a batch the action would reject", () => {
    for (const size of [1, 199, 200, 201, 999]) {
      for (const batch of variantAvailabilityBatches(ids(size))) {
        expect(batch.length).toBeLessThanOrEqual(VARIANT_AVAILABILITY_LIMIT);
        expect(batch.length).toBeGreaterThan(0);
      }
    }
  });
});
