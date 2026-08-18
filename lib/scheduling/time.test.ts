import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  daysBetween,
  formatPickupTime,
  normalizeTime,
  pickupInstant,
  storeNowTime,
  storeToday,
} from "./time";

const LA = "America/Los_Angeles";

describe("normalizeTime", () => {
  it("accepts both HH:mm and the HH:mm:ss Postgres returns", () => {
    expect(normalizeTime("16:00")).toBe("16:00");
    expect(normalizeTime("16:00:00")).toBe("16:00");
  });

  it("rejects malformed times rather than silently coercing", () => {
    expect(() => normalizeTime("25:00")).toThrow();
    expect(() => normalizeTime("4pm")).toThrow();
    expect(() => normalizeTime("")).toThrow();
  });
});

describe("store-local now", () => {
  it("reports the store's date, not UTC's", () => {
    // 01:00 UTC on Mar 8 is still 17:00 on Mar 7 in Los Angeles.
    const now = new Date("2026-03-08T01:00:00Z");
    expect(storeToday(now, LA)).toBe("2026-03-07");
    expect(storeNowTime(now, LA)).toBe("17:00");
  });

  it("reports the store's date across the other direction too", () => {
    // 23:00 UTC on Mar 7 is 15:00 the same day in Los Angeles.
    const now = new Date("2026-03-07T23:00:00Z");
    expect(storeToday(now, LA)).toBe("2026-03-07");
    expect(storeNowTime(now, LA)).toBe("15:00");
  });
});

describe("addCalendarDays", () => {
  it("adds plain calendar days", () => {
    expect(addCalendarDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addCalendarDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(addCalendarDays("2026-03-07", 0)).toBe("2026-03-07");
  });

  it("crosses the spring-forward boundary exactly once", () => {
    // US DST begins Sunday 2026-03-08. Naive +24h arithmetic in local time
    // would land back on the 8th here.
    expect(addCalendarDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addCalendarDays("2026-03-07", 2)).toBe("2026-03-09");
  });

  it("crosses the fall-back boundary exactly once", () => {
    // US DST ends Sunday 2026-11-01, a 25-hour local day.
    expect(addCalendarDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addCalendarDays("2026-10-31", 2)).toBe("2026-11-02");
  });

  it("rolls over months and leap years", () => {
    expect(addCalendarDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29"); // 2028 is a leap year
    expect(addCalendarDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("goes backwards", () => {
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("daysBetween", () => {
  it("counts calendar days in both directions, including across DST", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-03-09", "2026-03-07")).toBe(-2);
    expect(daysBetween("2026-03-07", "2026-03-07")).toBe(0);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });
});

describe("pickupInstant", () => {
  it("resolves a store wall-clock time to the correct instant in PST", () => {
    // 2026-03-07 is before DST begins, so Los Angeles is UTC-8.
    expect(pickupInstant("2026-03-07", "16:00", LA).toISOString()).toBe(
      "2026-03-08T00:00:00.000Z",
    );
  });

  it("resolves the same wall-clock time an hour earlier once DST is active", () => {
    // 2026-03-09 is after DST begins, so Los Angeles is UTC-7. A 4 PM pickup is
    // still 4 PM in the shop — the underlying instant is what shifts.
    expect(pickupInstant("2026-03-09", "16:00", LA).toISOString()).toBe(
      "2026-03-09T23:00:00.000Z",
    );
  });

  it("accepts HH:mm:ss from the database", () => {
    expect(pickupInstant("2026-03-07", "16:00:00", LA).toISOString()).toBe(
      "2026-03-08T00:00:00.000Z",
    );
  });
});

describe("formatPickupTime", () => {
  it("renders 12-hour times for customers", () => {
    expect(formatPickupTime("16:00")).toBe("4:00 PM");
    expect(formatPickupTime("20:00")).toBe("8:00 PM");
    expect(formatPickupTime("05:45")).toBe("5:45 AM");
    expect(formatPickupTime("00:30")).toBe("12:30 AM");
    expect(formatPickupTime("12:00")).toBe("12:00 PM");
  });
});
