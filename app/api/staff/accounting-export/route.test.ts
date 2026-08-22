import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasStaffSession: vi.fn(),
  getAccountingTransactions: vi.fn(),
  accountingTransactionsCsv: vi.fn(),
}));

vi.mock("@/lib/auth/guard", () => ({ hasStaffSession: mocks.hasStaffSession }));
vi.mock("@/lib/orders/accounting-export", () => ({
  getAccountingTransactions: mocks.getAccountingTransactions,
  accountingTransactionsCsv: mocks.accountingTransactionsCsv,
  parseAccountingExportFilter: (input: { from: string | null; to: string | null; location: string | null }) =>
    input.from === "2026-08-01" && input.to === "2026-08-31"
      ? { from: input.from, to: input.to, ...(input.location ? { locationId: input.location } : {}) }
      : null,
}));

import { GET } from "./route";

describe("accounting export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasStaffSession.mockResolvedValue(true);
    mocks.getAccountingTransactions.mockResolvedValue([]);
    mocks.accountingTransactionsCsv.mockReturnValue("transaction_type\r\n");
  });

  it("rejects unauthenticated downloads", async () => {
    mocks.hasStaffSession.mockResolvedValue(false);
    await expect(GET(new Request("https://example.com/api/staff/accounting-export?from=2026-08-01&to=2026-08-31")))
      .resolves.toMatchObject({ status: 401 });
  });

  it("streams a private CSV for the selected location and period", async () => {
    const response = await GET(new Request("https://example.com/api/staff/accounting-export?from=2026-08-01&to=2026-08-31&location=LOC_1"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getAccountingTransactions).toHaveBeenCalledWith({
      from: "2026-08-01",
      to: "2026-08-31",
      locationId: "LOC_1",
    });
  });
});
