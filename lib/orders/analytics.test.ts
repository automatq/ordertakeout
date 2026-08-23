import { describe, expect, it } from "vitest";

import { aggregateByWeekday, aggregateSlots, parseAnalyticsWindow } from "./analytics";

const TODAY = "2026-08-23";

describe("parseAnalyticsWindow", () => {
  it("uses explicit dates when both are valid", () => {
    expect(parseAnalyticsWindow({ from: "2026-07-01", to: "2026-07-31", today: TODAY })).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("falls back to the preset for a reversed, fake, or oversized range", () => {
    const fallback = { from: "2026-08-17", to: TODAY, preset: 7 };
    expect(parseAnalyticsWindow({ from: "2026-07-31", to: "2026-07-01", today: TODAY })).toEqual(fallback);
    expect(parseAnalyticsWindow({ from: "2026-02-30", to: "2026-03-01", today: TODAY })).toEqual(fallback);
    expect(parseAnalyticsWindow({ from: "2020-01-01", to: "2026-08-01", today: TODAY })).toEqual(fallback);
    expect(parseAnalyticsWindow({ from: "garbage", to: "2026-08-01", today: TODAY })).toEqual(fallback);
  });

  it("keeps the preset links working", () => {
    expect(parseAnalyticsWindow({ range: "30", today: TODAY })).toEqual({
      from: "2026-07-25",
      to: TODAY,
      preset: 30,
    });
    expect(parseAnalyticsWindow({ range: "999", today: TODAY })).toMatchObject({ preset: 7 });
  });
});

describe("aggregateByWeekday", () => {
  it("totals revenue and orders per weekday with occurrence counts", () => {
    const points = aggregateByWeekday([
      { date: "2026-08-17", revenueCents: 1000, orderCount: 2 }, // Monday
      { date: "2026-08-22", revenueCents: 5000, orderCount: 4 }, // Saturday
      { date: "2026-08-24", revenueCents: 700, orderCount: 1 }, // Monday again
    ]);
    const monday = points[0]!;
    const saturday = points[5]!;
    expect(monday).toMatchObject({ label: "Mon", revenueCents: 1700, orderCount: 3, occurrences: 2 });
    expect(saturday).toMatchObject({ label: "Sat", revenueCents: 5000, orderCount: 4, occurrences: 1 });
    expect(points[6]).toMatchObject({ label: "Sun", revenueCents: 0, occurrences: 0 });
  });
});

describe("aggregateSlots", () => {
  it("merges Postgres HH:mm:ss and HH:mm shapes onto one slot, sorted", () => {
    const slots = aggregateSlots([
      { time: "17:00:00", orderCount: 1, revenueCents: 2500 },
      { time: "16:00", orderCount: 2, revenueCents: 5000 },
      { time: "16:00:00", orderCount: 3, revenueCents: 7500 },
    ]);
    expect(slots).toEqual([
      { time: "16:00", orderCount: 5, revenueCents: 12500 },
      { time: "17:00", orderCount: 1, revenueCents: 2500 },
    ]);
  });
});
