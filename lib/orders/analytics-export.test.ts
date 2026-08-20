import { describe, expect, it } from "vitest";

import { salesAnalyticsCsv } from "./analytics-export";

describe("salesAnalyticsCsv", () => {
  it("aligns current and previous periods and formats cents as decimals", () => {
    const csv = salesAnalyticsCsv({
      currency: "CAD",
      byDay: [{ date: "2026-08-19", orderCount: 2, revenueCents: 12345 }],
      previousByDay: [{ date: "2026-08-12", orderCount: 1, revenueCents: 5000 }],
    });

    expect(csv).toContain("pickup_date,orders,revenue,currency,previous_pickup_date");
    expect(csv).toContain("2026-08-19,2,123.45,CAD,2026-08-12,1,50.00");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("keeps a missing comparison point explicit instead of dropping the row", () => {
    const csv = salesAnalyticsCsv({
      currency: "CAD",
      byDay: [{ date: "2026-08-19", orderCount: 0, revenueCents: 0 }],
      previousByDay: [],
    });

    expect(csv).toContain("2026-08-19,0,0.00,CAD,,0,0.00");
  });
});
