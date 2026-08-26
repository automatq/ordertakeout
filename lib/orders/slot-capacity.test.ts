import { describe, expect, it } from "vitest";

import { resolveSlotCapacity } from "./dashboard";

const DATE = "2026-08-26";
const TIME = "16:00";
const ALL = ["WILSON", "TORONTO", "LONDON"];

const perDate = (
  squareLocationId: string | null,
  maxOrders: number,
  pickupTime = "16:00:00",
) => ({ squareLocationId, pickupDate: DATE, pickupTime, maxOrders });

const configured = (locationId: string | null, maxOrdersPerSlot: number) => ({
  locationId,
  maxOrdersPerSlot,
});

describe("resolveSlotCapacity", () => {
  it("falls back to the compiled-in default when nothing is configured", () => {
    // Three locations, five apiece.
    expect(resolveSlotCapacity(DATE, TIME, ALL, { perDate: [], defaults: [] })).toBe(15);
  });

  it("uses the shop-wide default the bakery set", () => {
    /* Regression: this screen resolved to the hardcoded 5 while the storefront
       honoured the configured number, so a shop with a 30-order default sold 30
       and was told "1 of 15". */
    expect(
      resolveSlotCapacity(DATE, TIME, ALL, { perDate: [], defaults: [configured(null, 30)] }),
    ).toBe(90);
  });

  it("lets one branch override the shop-wide default", () => {
    expect(
      resolveSlotCapacity(DATE, TIME, ALL, {
        perDate: [],
        defaults: [configured(null, 30), configured("WILSON", 8)],
      }),
    ).toBe(8 + 30 + 30);
  });

  it("lets a per-date row beat the standing default", () => {
    // Otherwise closing one afternoon would mean changing the everyday number.
    expect(
      resolveSlotCapacity(DATE, TIME, ALL, {
        perDate: [perDate("WILSON", 0)],
        defaults: [configured(null, 30), configured("WILSON", 8)],
      }),
    ).toBe(0 + 30 + 30);
  });

  it("applies an all-locations per-date row to branches without their own", () => {
    expect(
      resolveSlotCapacity(DATE, TIME, ALL, {
        perDate: [perDate(null, 2), perDate("WILSON", 9)],
        defaults: [configured(null, 30)],
      }),
    ).toBe(9 + 2 + 2);
  });

  it("matches HH:mm against the HH:mm:ss Postgres returns", () => {
    // Regression: the same mismatch that once produced duplicate timeline lanes.
    expect(
      resolveSlotCapacity(DATE, "16:00", ["WILSON"], {
        perDate: [perDate("WILSON", 1, "16:00:00")],
        defaults: [configured(null, 30)],
      }),
    ).toBe(1);
  });

  it("ignores rows for a different date or time", () => {
    expect(
      resolveSlotCapacity(DATE, TIME, ["WILSON"], {
        perDate: [
          { squareLocationId: "WILSON", pickupDate: "2026-08-27", pickupTime: "16:00", maxOrders: 1 },
          perDate("WILSON", 2, "17:00"),
        ],
        defaults: [configured(null, 30)],
      }),
    ).toBe(30);
  });

  it("counts only the location asked for when the view is filtered", () => {
    expect(
      resolveSlotCapacity(DATE, TIME, ["WILSON"], {
        perDate: [],
        defaults: [configured(null, 30), configured("WILSON", 8)],
      }),
    ).toBe(8);
  });
});
