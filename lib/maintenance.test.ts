import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  sweepExpiredHolds: vi.fn(),
  sweepExpiredInventoryHolds: vi.fn(),
  retryFailedNotifications: vi.fn(),
  retrySquareOrderSync: vi.fn(),
  recoverStalePaymentAttempts: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/env", () => ({
  serverEnv: () => ({ CUSTOMER_DATA_RETENTION_DAYS: 0 }),
}));
vi.mock("@/lib/scheduling/queries", () => ({
  sweepExpiredHolds: mocks.sweepExpiredHolds,
}));
vi.mock("@/lib/inventory/reservations", () => ({
  sweepExpiredInventoryHolds: mocks.sweepExpiredInventoryHolds,
}));
vi.mock("@/lib/notifications/dispatch", () => ({
  retryFailedNotifications: mocks.retryFailedNotifications,
}));
vi.mock("@/lib/orders/transitions", () => ({
  retrySquareOrderSync: mocks.retrySquareOrderSync,
}));
vi.mock("@/lib/orders/create", () => ({
  recoverStalePaymentAttempts: mocks.recoverStalePaymentAttempts,
}));
vi.mock("@/lib/accounts/phone-sign-in", () => ({
  sweepPhoneSignInCodes: async () => 0,
}));

vi.mock("@/lib/accounts/magic-link", () => ({
  sweepMagicLinkTokens: async () => 0,
}));
vi.mock("@/lib/notifications/reminders", () => ({
  sendPickupReminders: async () => 0,
}));

import { runFastMaintenance, runMaintenance } from "./maintenance";

function emptyDelete() {
  return {
    where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })),
  };
}

describe("maintenance payment recovery", () => {
  beforeEach(() => {
    mocks.db.mockReset();
    mocks.sweepExpiredHolds.mockResolvedValue(2);
    mocks.sweepExpiredInventoryHolds.mockResolvedValue(3);
    mocks.retryFailedNotifications.mockResolvedValue(1);
    mocks.recoverStalePaymentAttempts.mockResolvedValue({
      examined: 2,
      resolved: 1,
      unresolved: 1,
    });
    mocks.retrySquareOrderSync.mockReset();

    const select = {
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
      })),
    };
    const tx = { delete: vi.fn(() => emptyDelete()) };
    mocks.db.mockReturnValue({
      select: vi.fn(() => select),
      transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    });
  });

  it("runs stale payment reconciliation and surfaces unresolved attempts", async () => {
    await expect(runMaintenance()).resolves.toMatchObject({
      holds: 2,
      inventoryHolds: 3,
      retries: 1,
      paymentAttempts: { examined: 2, resolved: 1, unresolved: 1 },
    });
    expect(mocks.recoverStalePaymentAttempts).toHaveBeenCalledOnce();
  });

  it("keeps pruning and anonymization out of the fast pass", async () => {
    const transaction = vi.fn();
    const select = {
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
      })),
    };
    mocks.db.mockReturnValue({ select: vi.fn(() => select), transaction });

    const result = await runFastMaintenance();

    expect(result).toMatchObject({
      holds: 2,
      inventoryHolds: 3,
      retries: 1,
      paymentAttempts: { examined: 2, resolved: 1, unresolved: 1 },
    });
    expect(result).not.toHaveProperty("operationalRows");
    expect(result).not.toHaveProperty("anonymizedOrders");
    // pruneOperationalData is the only transaction user; the fast pass must not prune.
    expect(transaction).not.toHaveBeenCalled();
  });
});
