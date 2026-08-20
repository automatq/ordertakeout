import { describe, expect, it } from "vitest";

import { groupDashboardOrders, type DashboardOrder } from "./dashboard";

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
