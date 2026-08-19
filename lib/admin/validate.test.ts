import { describe, expect, it } from "vitest";

import {
  blackoutSchema,
  parsePickupTimes,
  productRulesSchema,
  slotCapacitySchema,
  warnAboutRules,
} from "./validate";

describe("parsePickupTimes", () => {
  it("parses the Ensaymada window as the requirements state it", () => {
    expect(parsePickupTimes("16:00,17:00,18:00,19:00,20:00")).toEqual({
      ok: true,
      times: ["16:00", "17:00", "18:00", "19:00", "20:00"],
    });
  });

  it("accepts spaces, commas, or both", () => {
    const expected = { ok: true, times: ["16:00", "17:00"] };
    expect(parsePickupTimes("16:00 17:00")).toEqual(expected);
    expect(parsePickupTimes("16:00, 17:00")).toEqual(expected);
    expect(parsePickupTimes("  16:00 ,  17:00  ")).toEqual(expected);
  });

  it("zero-pads single-digit hours", () => {
    // Everything downstream compares times as strings, so "9:00" must become
    // "09:00" or it would sort after "16:00".
    expect(parsePickupTimes("9:00,16:00")).toEqual({ ok: true, times: ["09:00", "16:00"] });
  });

  it("sorts and de-duplicates so storefront order is stable", () => {
    expect(parsePickupTimes("20:00,16:00,18:00,16:00")).toEqual({
      ok: true,
      times: ["16:00", "18:00", "20:00"],
    });
  });

  it("accepts seconds from a copied database value", () => {
    expect(parsePickupTimes("16:00:00")).toEqual({ ok: true, times: ["16:00"] });
  });

  it("reports which tokens were wrong rather than failing silently", () => {
    expect(parsePickupTimes("16:00, 4pm, 25:00")).toEqual({
      ok: false,
      invalid: ["4pm", "25:00"],
    });
  });

  it("rejects an empty field", () => {
    expect(parsePickupTimes("")).toEqual({ ok: false, invalid: [] });
    expect(parsePickupTimes("   ")).toEqual({ ok: false, invalid: [] });
  });
});

describe("productRulesSchema", () => {
  const valid = {
    productId: "ITEM_ENSAYMADA",
    slug: "ensaymada-tray",
    leadTimeDays: "1",
    orderCutoffTime: "18:00",
    pickupTimes: "16:00,17:00",
    maxUnitsPerDay: "40",
    isOrderable: "true",
  };

  it("accepts the Ensaymada rules from the requirements document", () => {
    const parsed = productRulesSchema.parse(valid);
    expect(parsed.leadTimeDays).toBe(1);
    expect(parsed.maxUnitsPerDay).toBe(40);
    expect(parsed.slug).toBe("ensaymada-tray");
  });

  it("treats a blank daily cap as unlimited", () => {
    // The store often has no meaningful ceiling, and forcing a number would make
    // them invent one.
    expect(productRulesSchema.parse({ ...valid, maxUnitsPerDay: "" }).maxUnitsPerDay).toBeNull();
  });

  it("rejects a slug that would break the product URL", () => {
    for (const slug of ["Ensaymada Tray", "ensaymada_tray", "-leading", "trailing-", ""]) {
      expect(productRulesSchema.safeParse({ ...valid, slug }).success).toBe(false);
    }
  });

  it("rejects impossible lead times", () => {
    expect(productRulesSchema.safeParse({ ...valid, leadTimeDays: "-1" }).success).toBe(false);
    expect(productRulesSchema.safeParse({ ...valid, leadTimeDays: "1.5" }).success).toBe(false);
    expect(productRulesSchema.safeParse({ ...valid, leadTimeDays: "999" }).success).toBe(false);
  });

  it("rejects a malformed cutoff", () => {
    for (const time of ["6pm", "18", "25:00", ""]) {
      expect(productRulesSchema.safeParse({ ...valid, orderCutoffTime: time }).success).toBe(
        false,
      );
    }
  });

  it("allows a zero-day lead time for same-day products", () => {
    expect(productRulesSchema.parse({ ...valid, leadTimeDays: "0" }).leadTimeDays).toBe(0);
  });
});

describe("warnAboutRules", () => {
  it("says nothing about sensible rules", () => {
    expect(
      warnAboutRules({
        leadTimeDays: 1,
        orderCutoffTime: "18:00",
        pickupTimes: ["16:00", "17:00"],
      }),
    ).toEqual([]);
  });

  it("warns when no pickup times are offered", () => {
    expect(
      warnAboutRules({ leadTimeDays: 1, orderCutoffTime: "18:00", pickupTimes: [] })[0],
    ).toContain("never order");
  });

  it("warns when a same-day cutoff sits after the first pickup slot", () => {
    // The genuinely confusing configuration: same-day ordering with a 6 PM
    // cutoff but a 4 PM first slot, so the early slots can't be booked.
    const warnings = warnAboutRules({
      leadTimeDays: 0,
      orderCutoffTime: "18:00",
      pickupTimes: ["16:00", "20:00"],
    });
    expect(warnings.some((w) => w.includes("unreachable"))).toBe(true);
  });

  it("does not warn about the cutoff when there is a lead time", () => {
    // With a day's lead time, a cutoff after the pickup time is normal — that's
    // exactly the Ensaymada rule.
    const warnings = warnAboutRules({
      leadTimeDays: 1,
      orderCutoffTime: "18:00",
      pickupTimes: ["16:00"],
    });
    expect(warnings.some((w) => w.includes("unreachable"))).toBe(false);
  });
});

describe("blackout and capacity schemas", () => {
  it("accepts a blackout date with a reason", () => {
    expect(blackoutSchema.parse({ date: "2026-12-25", reason: "Christmas" }).date).toBe(
      "2026-12-25",
    );
  });

  it("rejects a malformed blackout date", () => {
    expect(blackoutSchema.safeParse({ date: "25/12/2026" }).success).toBe(false);
  });

  it("accepts a slot cap, including zero to close a slot", () => {
    expect(
      slotCapacitySchema.parse({
        pickupDate: "2026-03-05",
        pickupTime: "16:00",
        maxOrders: "0",
      }).maxOrders,
    ).toBe(0);
  });

  it("rejects a negative slot cap", () => {
    expect(
      slotCapacitySchema.safeParse({
        pickupDate: "2026-03-05",
        pickupTime: "16:00",
        maxOrders: "-1",
      }).success,
    ).toBe(false);
  });
});
