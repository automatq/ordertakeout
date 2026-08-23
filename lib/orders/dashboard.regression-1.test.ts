import { describe, expect, it } from "vitest";

import {
  groupDashboardOrders,
  mergeOperationalLocations,
  type DashboardOrder,
} from "./dashboard";

describe("groupDashboardOrders", () => {
  it("merges Postgres HH:mm:ss values with UI HH:mm values", () => {
    // Regression: ISSUE-003 — the prep timeline rendered duplicate 4:00 PM lanes.
    // Found by /qa on 2026-08-19
    // Report: .gstack/qa-reports/qa-report-localhost-2026-08-19.md
    const rows = [
      { id: "order-a", pickupDate: "2026-08-19", pickupTime: "16:00:00", items: [] },
      { id: "order-b", pickupDate: "2026-08-19", pickupTime: "16:00", items: [] },
    ] as unknown as DashboardOrder[];

    const slots = groupDashboardOrders(rows).get("2026-08-19");

    expect([...slots!.keys()]).toEqual(["16:00"]);
    expect(slots!.get("16:00")?.map((order) => order.id)).toEqual(["order-a", "order-b"]);
  });
});

describe("mergeOperationalLocations", () => {
  it("keeps stored pickup branches usable during a Square locations outage", () => {
    const rows = [{
      squareLocationId: "LONDON",
      pickupLocationName: "Harina — London",
      pickupLocationAddress: "123 Dundas St",
      pickupLocationCity: "London",
      pickupLocationTimezone: "America/Toronto",
      pickupLocationPhone: "519-555-0100",
      pickupLocationHours: [],
      currency: "CAD",
  country: "CA",
    }] as unknown as DashboardOrder[];

    expect(mergeOperationalLocations([], rows)).toEqual([
      expect.objectContaining({
        id: "LONDON",
        name: "Harina — London",
        address: "123 Dundas St",
      }),
    ]);
  });

  it("prefers current Square metadata over an older order snapshot", () => {
    const rows = [{
      squareLocationId: "TORONTO",
      pickupLocationName: "Old Toronto name",
      pickupLocationAddress: "Old address",
      pickupLocationCity: "Toronto",
      pickupLocationTimezone: "America/Toronto",
      pickupLocationPhone: null,
      pickupLocationHours: [],
      currency: "CAD",
    }] as unknown as DashboardOrder[];
    const live = [{
      id: "TORONTO",
      name: "Harina — Toronto East",
      address: "456 New St",
      city: "Toronto",
      timezone: "America/Toronto",
      currency: "CAD",
      country: null,
      phone: null,
      businessHours: [],
      coordinates: null,
    }];

    expect(mergeOperationalLocations(live, rows)).toEqual(live);
  });
});
