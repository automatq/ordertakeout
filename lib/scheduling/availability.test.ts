import { describe, expect, it } from "vitest";

import {
  computeAvailability,
  earliestPickupDate,
  productDayKey,
  slotKey,
  validatePickupSelection,
  type AvailabilityInput,
  type AvailabilityResult,
  type ProductRule,
} from "./availability";
import { pickupInstant } from "./time";

const LA = "America/Los_Angeles";

/** Build the instant at which it is `time` on `date` at the store. */
const at = (date: string, time: string) => pickupInstant(date, time, LA);

const ENSAYMADA_TIMES = ["16:00", "17:00", "18:00", "19:00", "20:00"] as const;

/** The one product whose rules the requirements document actually specifies. */
const ENSAYMADA: ProductRule = {
  productId: "ensaymada-25-ube",
  leadTimeDays: 1,
  orderCutoffTime: "18:00",
  allowedPickupTimes: ENSAYMADA_TIMES,
  maxUnitsPerDay: null,
  isOrderable: true,
};

function makeInput(overrides: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    now: at("2026-03-02", "15:00"), // Monday afternoon, before cutoff
    timeZone: LA,
    cart: [{ productId: ENSAYMADA.productId, quantity: 1 }],
    rules: [ENSAYMADA],
    horizonDays: 60,
    blackoutDates: new Set(),
    slotUsage: new Map(),
    slotCapacityOverrides: new Map(),
    defaultSlotCapacity: 5,
    productDayUsage: new Map(),
    ...overrides,
  };
}

function expectOk(result: AvailabilityResult) {
  if (!result.ok) {
    throw new Error(`Expected availability, got problem: ${JSON.stringify(result.problem)}`);
  }
  return result;
}

/* -------------------------------------------------------------------------- */

describe("the 6:00 PM cutoff (client question 8)", () => {
  it("allows next-day pickup right up to the deadline", () => {
    const result = expectOk(
      computeAvailability(makeInput({ now: at("2026-03-02", "17:59") })),
    );
    expect(result.earliestDate).toBe("2026-03-03");
  });

  it("treats 6:00 PM exactly as past the cutoff", () => {
    // "before 6:00 PM" excludes 6:00 PM itself, so the boundary is inclusive of
    // the rejection. This is the single most likely off-by-one in the system.
    const result = expectOk(
      computeAvailability(makeInput({ now: at("2026-03-02", "18:00") })),
    );
    expect(result.earliestDate).toBe("2026-03-04");
  });

  it("pushes to the day after next once past the cutoff", () => {
    const result = expectOk(
      computeAvailability(makeInput({ now: at("2026-03-02", "18:01") })),
    );
    expect(result.earliestDate).toBe("2026-03-04");
  });

  it("still applies late at night", () => {
    const result = expectOk(
      computeAvailability(makeInput({ now: at("2026-03-02", "23:30") })),
    );
    expect(result.earliestDate).toBe("2026-03-04");
  });

  it("resets in the morning", () => {
    const result = expectOk(
      computeAvailability(makeInput({ now: at("2026-03-03", "05:45") })),
    );
    expect(result.earliestDate).toBe("2026-03-04");
  });
});

describe("cutoff is evaluated in store time, not UTC", () => {
  it("uses the store's clock when UTC has already rolled over", () => {
    // 01:00 UTC on Mar 3 is 17:00 on Mar 2 in Los Angeles — before the cutoff.
    // Reading this as UTC would see "Mar 3, 01:00", also before cutoff, and
    // wrongly return Mar 4.
    const result = expectOk(
      computeAvailability(makeInput({ now: new Date("2026-03-03T01:00:00Z") })),
    );
    expect(result.earliestDate).toBe("2026-03-03");
  });

  it("uses the store's clock when UTC is still on the previous day", () => {
    // 02:30 UTC on Mar 3 is 18:30 on Mar 2 in Los Angeles — past the cutoff.
    const result = expectOk(
      computeAvailability(makeInput({ now: new Date("2026-03-03T02:30:00Z") })),
    );
    expect(result.earliestDate).toBe("2026-03-04");
  });
});

describe("daylight saving transitions", () => {
  it("counts calendar days across spring forward", () => {
    // US DST begins Sunday 2026-03-08. Ordering Saturday evening past the
    // cutoff should reach Monday the 9th, not skip or repeat a day.
    const result = expectOk(
      computeAvailability(makeInput({ now: at("2026-03-07", "20:00") })),
    );
    expect(result.earliestDate).toBe("2026-03-09");
    expect(result.days[0]?.date).toBe("2026-03-09");
  });

  it("counts calendar days across fall back", () => {
    // US DST ends Sunday 2026-11-01.
    const result = expectOk(
      computeAvailability(makeInput({ now: at("2026-10-31", "20:00") })),
    );
    expect(result.earliestDate).toBe("2026-11-02");
  });

  it("offers the same wall-clock pickup times either side of a transition", () => {
    const result = expectOk(
      computeAvailability(makeInput({ now: at("2026-03-07", "10:00") })),
    );
    const before = result.days.find((d) => d.date === "2026-03-08");
    const after = result.days.find((d) => d.date === "2026-03-09");
    expect(before?.slots.map((s) => s.time)).toEqual([...ENSAYMADA_TIMES]);
    expect(after?.slots.map((s) => s.time)).toEqual([...ENSAYMADA_TIMES]);
  });
});

describe("mixed carts", () => {
  const SLOW: ProductRule = {
    ...ENSAYMADA,
    productId: "hopia-60",
    leadTimeDays: 3,
  };

  it("is gated by the slowest item, not the fastest", () => {
    const result = expectOk(
      computeAvailability(
        makeInput({
          cart: [
            { productId: ENSAYMADA.productId, quantity: 1 },
            { productId: SLOW.productId, quantity: 1 },
          ],
          rules: [ENSAYMADA, SLOW],
        }),
      ),
    );
    // Ensaymada alone would allow Mar 3; the 3-day item pushes it to Mar 5.
    expect(result.earliestDate).toBe("2026-03-05");
  });

  it("applies each product's own cutoff", () => {
    const EARLY_CUTOFF: ProductRule = {
      ...ENSAYMADA,
      productId: "ube-bars-big",
      orderCutoffTime: "12:00",
    };
    const result = expectOk(
      computeAvailability(
        makeInput({
          now: at("2026-03-02", "15:00"), // past 12:00, before 18:00
          cart: [
            { productId: ENSAYMADA.productId, quantity: 1 },
            { productId: EARLY_CUTOFF.productId, quantity: 1 },
          ],
          rules: [ENSAYMADA, EARLY_CUTOFF],
        }),
      ),
    );
    // Ensaymada allows Mar 3; the noon-cutoff item has already missed today.
    expect(result.earliestDate).toBe("2026-03-04");
  });

  it("offers only pickup times common to every product", () => {
    const NARROW: ProductRule = {
      ...ENSAYMADA,
      productId: "hopia-90",
      allowedPickupTimes: ["18:00", "19:00", "21:00"],
    };
    const result = expectOk(
      computeAvailability(
        makeInput({
          cart: [
            { productId: ENSAYMADA.productId, quantity: 1 },
            { productId: NARROW.productId, quantity: 1 },
          ],
          rules: [ENSAYMADA, NARROW],
        }),
      ),
    );
    expect(result.offeredTimes).toEqual(["18:00", "19:00"]);
  });

  it("asks the customer to split the order when windows do not overlap", () => {
    const MORNING_ONLY: ProductRule = {
      ...ENSAYMADA,
      productId: "pandesal-tray",
      allowedPickupTimes: ["07:00", "08:00"],
    };
    const result = computeAvailability(
      makeInput({
        cart: [
          { productId: ENSAYMADA.productId, quantity: 1 },
          { productId: MORNING_ONLY.productId, quantity: 1 },
        ],
        rules: [ENSAYMADA, MORNING_ONLY],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.kind).toBe("no_common_pickup_time");
  });
});

describe("blackout dates", () => {
  it("closes every slot on a blacked-out day without hiding the day", () => {
    const result = expectOk(
      computeAvailability(makeInput({ blackoutDates: new Set(["2026-03-04"]) })),
    );
    const closed = result.days.find((d) => d.date === "2026-03-04");
    expect(closed?.hasAvailability).toBe(false);
    expect(closed?.slots.every((s) => s.reason === "blackout")).toBe(true);
    // Surrounding days are unaffected.
    expect(result.days.find((d) => d.date === "2026-03-03")?.hasAvailability).toBe(true);
    expect(result.days.find((d) => d.date === "2026-03-05")?.hasAvailability).toBe(true);
  });
});

describe("slot capacity (client question 9)", () => {
  it("counts down remaining orders in a slot", () => {
    const result = expectOk(
      computeAvailability(
        makeInput({ slotUsage: new Map([[slotKey("2026-03-03", "16:00"), 3]]) }),
      ),
    );
    const slot = result.days[0]?.slots.find((s) => s.time === "16:00");
    expect(slot?.available).toBe(true);
    expect(slot?.remainingOrders).toBe(2); // default capacity 5
  });

  it("closes a slot that is full and leaves its neighbours open", () => {
    const result = expectOk(
      computeAvailability(
        makeInput({ slotUsage: new Map([[slotKey("2026-03-03", "16:00"), 5]]) }),
      ),
    );
    const day = result.days[0];
    expect(day?.slots.find((s) => s.time === "16:00")).toMatchObject({
      available: false,
      reason: "slot_full",
      remainingOrders: 0,
    });
    expect(day?.slots.find((s) => s.time === "17:00")?.available).toBe(true);
    expect(day?.hasAvailability).toBe(true);
  });

  it("treats overbooked slots as full rather than reporting negative space", () => {
    const result = expectOk(
      computeAvailability(
        makeInput({ slotUsage: new Map([[slotKey("2026-03-03", "16:00"), 9]]) }),
      ),
    );
    expect(result.days[0]?.slots.find((s) => s.time === "16:00")?.remainingOrders).toBe(0);
  });

  it("honours a staff override for a single slot", () => {
    const result = expectOk(
      computeAvailability(
        makeInput({
          slotCapacityOverrides: new Map([[slotKey("2026-03-03", "16:00"), 1]]),
          slotUsage: new Map([[slotKey("2026-03-03", "16:00"), 1]]),
        }),
      ),
    );
    const day = result.days[0];
    expect(day?.slots.find((s) => s.time === "16:00")?.available).toBe(false);
    expect(day?.slots.find((s) => s.time === "17:00")?.remainingOrders).toBe(5);
  });
});

describe("per-day production capacity", () => {
  const CAPPED: ProductRule = { ...ENSAYMADA, maxUnitsPerDay: 10 };

  it("allows an order that fits within the day's remaining production", () => {
    const result = expectOk(
      computeAvailability(
        makeInput({
          rules: [CAPPED],
          cart: [{ productId: CAPPED.productId, quantity: 3 }],
          productDayUsage: new Map([[productDayKey(CAPPED.productId, "2026-03-03"), 7]]),
        }),
      ),
    );
    expect(result.days[0]?.hasAvailability).toBe(true);
  });

  it("closes the whole day when the order would exceed production", () => {
    const result = expectOk(
      computeAvailability(
        makeInput({
          rules: [CAPPED],
          cart: [{ productId: CAPPED.productId, quantity: 4 }],
          productDayUsage: new Map([[productDayKey(CAPPED.productId, "2026-03-03"), 7]]),
        }),
      ),
    );
    const day = result.days.find((d) => d.date === "2026-03-03");
    expect(day?.hasAvailability).toBe(false);
    expect(day?.slots.every((s) => s.reason === "product_daily_capacity")).toBe(true);
    // The cap is per day, so the next day is unaffected.
    expect(result.days.find((d) => d.date === "2026-03-04")?.hasAvailability).toBe(true);
  });

  it("accounts for quantity, not just order count", () => {
    const result = expectOk(
      computeAvailability(
        makeInput({ rules: [CAPPED], cart: [{ productId: CAPPED.productId, quantity: 11 }] }),
      ),
    );
    expect(result.days[0]?.hasAvailability).toBe(false);
  });

  it("treats a null cap as unlimited", () => {
    const result = expectOk(
      computeAvailability(makeInput({ cart: [{ productId: ENSAYMADA.productId, quantity: 999 }] })),
    );
    expect(result.days[0]?.hasAvailability).toBe(true);
  });
});

describe("booking horizon", () => {
  it("stops offering dates beyond the horizon, measured from today", () => {
    const result = expectOk(computeAvailability(makeInput({ horizonDays: 3 })));
    // Today is Mar 2, so the last bookable date is Mar 5; earliest is Mar 3.
    expect(result.days.map((d) => d.date)).toEqual([
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
    ]);
  });

  it("returns no days when the lead time already exceeds the horizon", () => {
    const result = expectOk(computeAvailability(makeInput({ horizonDays: 0 })));
    expect(result.days).toEqual([]);
  });
});

describe("cart validation", () => {
  it("rejects an empty cart", () => {
    const result = computeAvailability(makeInput({ cart: [] }));
    expect(result).toMatchObject({ ok: false, problem: { kind: "empty_cart" } });
  });

  it("rejects a product with no configured rule", () => {
    const result = computeAvailability(makeInput({ cart: [{ productId: "ghost", quantity: 1 }] }));
    expect(result).toMatchObject({
      ok: false,
      problem: { kind: "unknown_product", productId: "ghost" },
    });
  });

  it("rejects a product staff have switched off", () => {
    const result = computeAvailability(
      makeInput({ rules: [{ ...ENSAYMADA, isOrderable: false }] }),
    );
    expect(result).toMatchObject({ ok: false, problem: { kind: "product_unavailable" } });
  });

  it("rejects nonsensical quantities", () => {
    for (const quantity of [0, -1, 1.5, Number.NaN]) {
      const result = computeAvailability(
        makeInput({ cart: [{ productId: ENSAYMADA.productId, quantity }] }),
      );
      expect(result).toMatchObject({ ok: false, problem: { kind: "invalid_quantity" } });
    }
  });
});

describe("earliestPickupDate", () => {
  it("adds only the lead time before the cutoff", () => {
    expect(earliestPickupDate(ENSAYMADA, "2026-03-02", "17:59")).toBe("2026-03-03");
  });

  it("adds an extra day at or after the cutoff", () => {
    expect(earliestPickupDate(ENSAYMADA, "2026-03-02", "18:00")).toBe("2026-03-04");
  });

  it("handles a zero lead time as same-day-if-before-cutoff", () => {
    const sameDay: ProductRule = { ...ENSAYMADA, leadTimeDays: 0 };
    expect(earliestPickupDate(sameDay, "2026-03-02", "10:00")).toBe("2026-03-02");
    expect(earliestPickupDate(sameDay, "2026-03-02", "18:00")).toBe("2026-03-03");
  });
});

/* -------------------------------------------------------------------------- */

describe("validatePickupSelection (the server-side checkout guard)", () => {
  it("accepts a valid selection", () => {
    expect(
      validatePickupSelection(makeInput(), { date: "2026-03-03", time: "16:00" }),
    ).toEqual({ ok: true });
  });

  it("accepts the HH:mm:ss form the database returns", () => {
    expect(
      validatePickupSelection(makeInput(), { date: "2026-03-03", time: "16:00:00" }),
    ).toEqual({ ok: true });
  });

  it("rejects a stale selection once the cutoff has passed", () => {
    // The exact scenario from the requirements: the customer loaded the page at
    // 5:55 PM with tomorrow available, then paid at 6:05 PM.
    const result = validatePickupSelection(
      makeInput({ now: at("2026-03-02", "18:05") }),
      { date: "2026-03-03", time: "16:00" },
    );
    expect(result).toEqual({
      ok: false,
      rejection: { kind: "before_earliest_date", earliestDate: "2026-03-04" },
    });
  });

  it("rejects a pickup time the product is not offered at", () => {
    const result = validatePickupSelection(makeInput(), {
      date: "2026-03-03",
      time: "09:00",
    });
    expect(result).toMatchObject({ ok: false, rejection: { kind: "time_not_offered" } });
  });

  it("rejects a slot that filled up while the customer was paying", () => {
    const result = validatePickupSelection(
      makeInput({ slotUsage: new Map([[slotKey("2026-03-03", "16:00"), 5]]) }),
      { date: "2026-03-03", time: "16:00" },
    );
    expect(result).toEqual({
      ok: false,
      rejection: { kind: "slot_unavailable", reason: "slot_full" },
    });
  });

  it("rejects a blacked-out date", () => {
    const result = validatePickupSelection(
      makeInput({ blackoutDates: new Set(["2026-03-03"]) }),
      { date: "2026-03-03", time: "16:00" },
    );
    expect(result).toEqual({
      ok: false,
      rejection: { kind: "slot_unavailable", reason: "blackout" },
    });
  });

  it("rejects a date beyond the booking horizon", () => {
    const result = validatePickupSelection(makeInput({ horizonDays: 3 }), {
      date: "2026-06-01",
      time: "16:00",
    });
    expect(result).toEqual({ ok: false, rejection: { kind: "beyond_horizon" } });
  });

  it("surfaces cart problems rather than silently failing the slot check", () => {
    const result = validatePickupSelection(makeInput({ cart: [] }), {
      date: "2026-03-03",
      time: "16:00",
    });
    expect(result).toMatchObject({
      ok: false,
      rejection: { kind: "cart_problem", problem: { kind: "empty_cart" } },
    });
  });
});

describe("per-day 86 (staff 'sold out today')", () => {
  it("blocks every slot on the 86ed day for that product, like a one-item blackout", () => {
    const result = expectOk(
      computeAvailability(makeInput({
        productDateBlocks: new Set([productDayKey(ENSAYMADA.productId, "2026-03-03")]),
      })),
    );
    const blocked = result.days.find((day) => day.date === "2026-03-03");
    expect(blocked?.hasAvailability).toBe(false);
    expect(blocked?.slots.every((slot) => slot.reason === "product_sold_out")).toBe(true);
    const open = result.days.find((day) => day.date === "2026-03-04");
    expect(open?.hasAvailability).toBe(true);
  });

  it("does not touch other products' days", () => {
    const result = expectOk(
      computeAvailability(makeInput({
        productDateBlocks: new Set([productDayKey("some-other-product", "2026-03-03")]),
      })),
    );
    expect(result.days.find((day) => day.date === "2026-03-03")?.hasAvailability).toBe(true);
  });

  it("is enforced by the server-side checkout guard", () => {
    const rejection = validatePickupSelection(
      makeInput({
        productDateBlocks: new Set([productDayKey(ENSAYMADA.productId, "2026-03-03")]),
      }),
      { date: "2026-03-03", time: "16:00" },
    );
    expect(rejection).toEqual({
      ok: false,
      rejection: { kind: "slot_unavailable", reason: "product_sold_out" },
    });
  });
});

/* -------------------------------------------------------------------------- */

describe("same-day ordering (lead time 0)", () => {
  /** Everyday bread: orderable today, collectable across the whole trading day. */
  const PANDESAL: ProductRule = {
    productId: "pandesal",
    leadTimeDays: 0,
    orderCutoffTime: "20:00",
    allowedPickupTimes: ["06:00", "09:00", "12:00", "15:00", "18:00"],
    maxUnitsPerDay: null,
    isOrderable: true,
  };

  const sameDayInput = (overrides: Partial<AvailabilityInput> = {}) =>
    makeInput({
      cart: [{ productId: PANDESAL.productId, quantity: 1 }],
      rules: [PANDESAL],
      ...overrides,
    });

  it("never offers a pickup time that has already passed", () => {
    // Regression: buildDay never received the current time, so at 3 PM the
    // engine offered this morning's 06:00, 09:00 and 12:00 slots. It stayed
    // hidden because every product had leadTimeDays >= 1, which guarantees the
    // offered date is in the future.
    const result = expectOk(computeAvailability(sameDayInput({ now: at("2026-03-02", "15:00") })));
    const today = result.days.find((day) => day.date === "2026-03-02")!;

    expect(today.slots.filter((slot) => slot.available).map((slot) => slot.time)).toEqual([
      "15:00",
      "18:00",
    ]);
    for (const time of ["06:00", "09:00", "12:00"]) {
      expect(today.slots.find((slot) => slot.time === time)).toMatchObject({
        available: false,
        reason: "time_passed",
      });
    }
  });

  it("refuses a passed time at checkout, not just in the calendar", () => {
    // validatePickupSelection runs the same engine, and claimSlot re-validates
    // through it — so the server-side guard must reject this too.
    const result = validatePickupSelection(sameDayInput({ now: at("2026-03-02", "15:00") }), {
      date: "2026-03-02",
      time: "09:00",
    });

    expect(result).toEqual({
      ok: false,
      rejection: { kind: "slot_unavailable", reason: "time_passed" },
    });
  });

  it("still offers a slot at exactly the current time", () => {
    const result = expectOk(computeAvailability(sameDayInput({ now: at("2026-03-02", "15:00") })));
    const today = result.days.find((day) => day.date === "2026-03-02")!;
    expect(today.slots.find((slot) => slot.time === "15:00")?.available).toBe(true);
  });

  it("holds back slots inside the prep window", () => {
    const result = expectOk(
      computeAvailability(
        sameDayInput({
          now: at("2026-03-02", "14:50"),
          rules: [{ ...PANDESAL, minimumPrepMinutes: 20 }],
        }),
      ),
    );
    const today = result.days.find((day) => day.date === "2026-03-02")!;

    // 15:00 is only 10 minutes away and the kitchen needs 20.
    expect(today.slots.find((slot) => slot.time === "15:00")).toMatchObject({
      available: false,
      reason: "time_passed",
    });
    expect(today.slots.find((slot) => slot.time === "18:00")?.available).toBe(true);
  });

  it("closes the day entirely when the prep window runs past midnight", () => {
    const result = expectOk(
      computeAvailability(
        sameDayInput({
          now: at("2026-03-02", "23:50"),
          // Past the 20:00 cutoff, so today is gone anyway — pin the cutoff open
          // to isolate the midnight-wrap behaviour.
          rules: [{ ...PANDESAL, orderCutoffTime: "23:59", minimumPrepMinutes: 30 }],
        }),
      ),
    );
    const today = result.days.find((day) => day.date === "2026-03-02");

    expect(today?.hasAvailability).toBe(false);
    expect(today?.slots.every((slot) => slot.reason === "time_passed")).toBe(true);
  });

  it("gates a mixed cart on the slowest item's prep time", () => {
    const result = expectOk(
      computeAvailability(
        sameDayInput({
          now: at("2026-03-02", "14:30"),
          cart: [
            { productId: "pandesal", quantity: 1 },
            { productId: "hot-pie", quantity: 1 },
          ],
          rules: [
            { ...PANDESAL, minimumPrepMinutes: 0 },
            { ...PANDESAL, productId: "hot-pie", minimumPrepMinutes: 45 },
          ],
        }),
      ),
    );
    const today = result.days.find((day) => day.date === "2026-03-02")!;

    // 15:00 is 30 minutes out; the pie needs 45.
    expect(today.slots.find((slot) => slot.time === "15:00")?.available).toBe(false);
    expect(today.slots.find((slot) => slot.time === "18:00")?.available).toBe(true);
  });

  it("leaves future days untouched", () => {
    const result = expectOk(computeAvailability(sameDayInput({ now: at("2026-03-02", "15:00") })));
    const tomorrow = result.days.find((day) => day.date === "2026-03-03")!;
    expect(tomorrow.slots.every((slot) => slot.available)).toBe(true);
  });
});
