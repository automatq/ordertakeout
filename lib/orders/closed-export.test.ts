import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  searchClosedOrders: vi.fn(),
  serverEnv: vi.fn(),
}));

vi.mock("./dashboard", () => ({ searchClosedOrders: mocks.searchClosedOrders }));
vi.mock("@/lib/env", () => ({ serverEnv: mocks.serverEnv }));

import { closedOrdersCsv, CLOSED_EXPORT_MAX_ROWS } from "./closed-export";

function order(overrides: Record<string, unknown> = {}) {
  return {
    orderNumber: "PT-1001",
    status: "completed",
    pickupDate: "2026-08-20",
    pickupTime: "16:00",
    pickupLocationName: 'Wilson "Main" Branch',
    pickupLocationTimezone: "America/Toronto",
    customerName: "Santos, Maria",
    customerPhone: "+14165550142",
    items: [
      { quantity: 2, nameSnapshot: "25 pcs Ube" },
      { quantity: 1, nameSnapshot: "Hopia, assorted" },
    ],
    totalCents: 7000,
    refundedTotalCents: 2500,
    currency: "CAD",
    pickupVerification: {
      staffInitials: "MG",
      verifiedAt: new Date("2026-08-20T20:15:00Z"),
    },
    completedAt: new Date("2026-08-20T20:15:00Z"),
    canceledAt: null,
    ...overrides,
  };
}

describe("closedOrdersCsv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serverEnv.mockReturnValue({ STORE_TIMEZONE: "America/Toronto" });
  });

  it("escapes commas and quotes, includes refunds and verification evidence", async () => {
    mocks.searchClosedOrders.mockResolvedValue([order()]);
    const result = await closedOrdersCsv({});
    if (!result.ok) throw new Error("expected csv");

    const [header, row] = result.csv.trim().split("\r\n");
    expect(header).toContain("refunded_total");
    expect(row).toContain('"Santos, Maria"');
    expect(row).toContain('"Wilson ""Main"" Branch"');
    expect(row).toContain('"2x 25 pcs Ube; 1x Hopia, assorted"');
    expect(row).toContain("70.00");
    expect(row).toContain("25.00");
    expect(row).toContain("MG");
    // Verified time rendered in the order's own timezone (20:15Z = 16:15 Toronto).
    expect(row).toContain("2026-08-20 16:15");
  });

  it("refuses instead of silently truncating past the row cap", async () => {
    mocks.searchClosedOrders.mockResolvedValue(
      Array.from({ length: CLOSED_EXPORT_MAX_ROWS + 1 }, () => order()),
    );
    await expect(closedOrdersCsv({})).resolves.toEqual({ ok: false, reason: "too_many_rows" });
  });
});
