import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  refundSquarePayment: vi.fn(),
  validateInitials: vi.fn(),
  rosterRequiresPin: vi.fn(),
  verifyStaffPin: vi.fn(),
  recordAuditWithin: vi.fn(),
  notifyOrderRefund: vi.fn(),
}));

vi.mock("next/server", () => ({ after: (callback: () => unknown) => callback() }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/square/orders", () => ({ refundSquarePayment: mocks.refundSquarePayment }));
vi.mock("@/lib/staff/roster", () => ({
  validateInitials: mocks.validateInitials,
  rosterRequiresPin: mocks.rosterRequiresPin,
  verifyStaffPin: mocks.verifyStaffPin,
}));
vi.mock("@/lib/audit/log", () => ({ recordAuditWithin: mocks.recordAuditWithin }));
vi.mock("@/lib/notifications/dispatch", () => ({ notifyOrderRefund: mocks.notifyOrderRefund }));
vi.mock("@/lib/orders/payment-state", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/orders/payment-state")>(),
  createRefundAttemptKey: () => "refund-key-1",
}));

import { claimRefund, refundCompletedOrder, remainingRefundableCents } from "./refunds";

const ORDER = {
  id: "00000000-0000-4000-8000-000000000001",
  orderNumber: "PT-9001",
  status: "completed",
  squarePaymentId: "PAY_9",
  squareRefundId: null,
  refundAttemptKey: null,
  refundAttemptStartedAt: null,
  refundStatus: "not_required",
  refundError: null,
  totalCents: 5000,
  tipCents: 0,
  refundedTotalCents: 0,
  customerAccountId: null,
  currency: "CAD",
  updatedAt: new Date("2026-08-22T12:00:00Z"),
} as never;

function selectRowsDb(rows: unknown[]) {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn(async () => rows),
  };
  return { select: vi.fn(() => builder) };
}

function claimTransactionDb(updateRows: { id: string }[], captureInsert?: (v: Record<string, unknown>) => void) {
  const updateBuilder = {
    set: vi.fn(() => updateBuilder),
    where: vi.fn(() => updateBuilder),
    returning: vi.fn(async () => updateRows),
  };
  const insertBuilder = {
    values: vi.fn(async (value: Record<string, unknown>) => { captureInsert?.(value); }),
  };
  const tx = { update: vi.fn(() => updateBuilder), insert: vi.fn(() => insertBuilder) };
  return { transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
}

describe("remainingRefundableCents", () => {
  it("subtracts completed refunds from the charged amount (total + tip)", () => {
    expect(remainingRefundableCents({ totalCents: 5000, tipCents: 0, refundedTotalCents: 0 })).toBe(5000);
    expect(remainingRefundableCents({ totalCents: 5000, tipCents: 500, refundedTotalCents: 0 })).toBe(5500);
    expect(remainingRefundableCents({ totalCents: 5000, tipCents: 500, refundedTotalCents: 1500 })).toBe(4000);
    expect(remainingRefundableCents({ totalCents: 5000, tipCents: 0, refundedTotalCents: 6000 })).toBe(0);
  });
});

describe("claimRefund", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses to claim over a refund started outside the app", async () => {
    const order = { ...(ORDER as Record<string, unknown>), refundStatus: "pending", refundAttemptKey: null } as never;
    await expect(claimRefund(order, new Date(), { amountCents: 100, origin: "staff" }))
      .resolves.toEqual({ ok: false, kind: "external_pending" });
    expect(mocks.db).not.toHaveBeenCalled();
  });

  it("reports an in-flight attempt while its lease is fresh", async () => {
    const order = {
      ...(ORDER as Record<string, unknown>),
      refundStatus: "pending",
      refundAttemptKey: "refund-old",
      refundAttemptStartedAt: new Date(),
    } as never;
    await expect(claimRefund(order, new Date(), { amountCents: 100, origin: "staff" }))
      .resolves.toEqual({ ok: false, kind: "in_flight" });
  });

  it("claims fresh: locks the order and writes the pending ledger row atomically", async () => {
    let ledgerInsert: Record<string, unknown> | undefined;
    mocks.db.mockReturnValueOnce(claimTransactionDb([{ id: "o1" }], (value) => { ledgerInsert = value; }));

    await expect(
      claimRefund(ORDER, new Date(), { amountCents: 1200, origin: "staff", initiatedBy: "MG", reason: "wrong tray" }),
    ).resolves.toEqual({ ok: true, key: "refund-key-1", amountCents: 1200 });
    expect(ledgerInsert).toMatchObject({
      attemptKey: "refund-key-1",
      origin: "staff",
      amountCents: 1200,
      status: "pending",
      initiatedBy: "MG",
      reason: "wrong tray",
    });
  });

  it("reports a race when the guarded lock update wins nothing", async () => {
    mocks.db.mockReturnValueOnce(claimTransactionDb([]));
    await expect(claimRefund(ORDER, new Date(), { amountCents: 1200, origin: "staff" }))
      .resolves.toEqual({ ok: false, kind: "raced" });
  });
});

describe("refundCompletedOrder guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateInitials.mockResolvedValue({ ok: true, memberId: "m1" });
    mocks.rosterRequiresPin.mockResolvedValue(false);
  });

  it("rejects initials the roster rejects, before reading the order", async () => {
    mocks.validateInitials.mockResolvedValue({ ok: false, message: "Not on the roster." });
    await expect(
      refundCompletedOrder({ orderId: "o1", amountCents: 100, reason: "x", staffInitials: "ZZ" }),
    ).resolves.toEqual({ ok: false, reason: "Not on the roster." });
    expect(mocks.db).not.toHaveBeenCalled();
  });

  it("requires and verifies a PIN when the member has one", async () => {
    mocks.rosterRequiresPin.mockResolvedValue(true);
    await expect(
      refundCompletedOrder({ orderId: "o1", amountCents: 100, reason: "x", staffInitials: "MG" }),
    ).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("PIN") });

    mocks.verifyStaffPin.mockResolvedValue(false);
    await expect(
      refundCompletedOrder({ orderId: "o1", amountCents: 100, reason: "x", staffInitials: "MG", staffPin: "1234" }),
    ).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("PIN") });
    expect(mocks.refundSquarePayment).not.toHaveBeenCalled();
  });

  it("only refunds completed orders", async () => {
    mocks.db.mockReturnValueOnce(selectRowsDb([{ ...(ORDER as Record<string, unknown>), status: "ready" }]));
    await expect(
      refundCompletedOrder({ orderId: "o1", amountCents: 100, reason: "x", staffInitials: "MG" }),
    ).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("Cancel an active order") });
  });

  it("caps the amount at the remaining refundable balance", async () => {
    mocks.db.mockReturnValueOnce(
      selectRowsDb([{ ...(ORDER as Record<string, unknown>), refundedTotalCents: 4500 }]),
    );
    await expect(
      refundCompletedOrder({ orderId: "o1", amountCents: 600, reason: "x", staffInitials: "MG" }),
    ).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("remaining refundable") });
    expect(mocks.refundSquarePayment).not.toHaveBeenCalled();
  });

  it("refuses when the order is already fully refunded", async () => {
    mocks.db.mockReturnValueOnce(
      selectRowsDb([{ ...(ORDER as Record<string, unknown>), refundedTotalCents: 5000 }]),
    );
    await expect(
      refundCompletedOrder({ orderId: "o1", amountCents: 1, reason: "x", staffInitials: "MG" }),
    ).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("already fully refunded") });
  });
});
