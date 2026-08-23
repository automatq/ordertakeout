import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/monitoring/report", () => ({ reportError: mocks.reportError }));

import { recordAudit, recordAuditWithin } from "./log";

describe("audit log", () => {
  const values = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    values.mockResolvedValue(undefined);
    mocks.db.mockReturnValue({ insert: vi.fn(() => ({ values })) });
  });

  it("maps entry fields onto the row with defaults", async () => {
    await recordAudit({
      actorType: "staff",
      actorInitials: "mg",
      action: "order.refunded",
      entityType: "order",
      orderId: "order-1",
      metadata: { amountCents: 500 },
    });

    expect(values).toHaveBeenCalledWith({
      actorType: "staff",
      actorInitials: "mg",
      action: "order.refunded",
      entityType: "order",
      entityId: null,
      orderId: "order-1",
      metadata: { amountCents: 500 },
    });
  });

  it("never throws when the write fails, and reports instead", async () => {
    values.mockRejectedValue(new Error("db down"));
    await expect(
      recordAudit({ actorType: "system:cron", action: "maintenance.ran", entityType: "system" }),
    ).resolves.toBeUndefined();
    expect(mocks.reportError).toHaveBeenCalled();
  });

  it("recordAuditWithin propagates failures so transactions roll back", async () => {
    values.mockRejectedValue(new Error("db down"));
    const tx = { insert: vi.fn(() => ({ values })) };
    await expect(
      recordAuditWithin(tx as never, {
        actorType: "staff",
        action: "order.refunded",
        entityType: "order",
      }),
    ).rejects.toThrow("db down");
  });
});
