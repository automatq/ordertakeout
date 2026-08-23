import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  notifyOrder: vi.fn(),
  notifyOrderRefund: vi.fn(),
  mirrorToSquare: vi.fn(),
  releaseInventoryHoldsWithin: vi.fn(),
  retainInventoryHoldsAfterPaymentWithin: vi.fn(),
  resolveWebhookLedgerRow: vi.fn(),
  settleLedgerRowWithin: vi.fn(),
  markLedgerRowById: vi.fn(),
  revokeEarnedPointsWithin: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/notifications/dispatch", () => ({
  notifyOrder: mocks.notifyOrder,
  notifyOrderRefund: mocks.notifyOrderRefund,
}));
vi.mock("@/lib/orders/transitions", () => ({ mirrorToSquare: mocks.mirrorToSquare }));
// The ledger has its own suite (refunds.test.ts); stubbing it keeps these tests
// focused on the orders-table reconciliation choreography.
vi.mock("@/lib/orders/refunds", () => ({
  resolveWebhookLedgerRow: mocks.resolveWebhookLedgerRow,
  settleLedgerRowWithin: mocks.settleLedgerRowWithin,
  markLedgerRowById: mocks.markLedgerRowById,
  revokeEarnedPointsWithin: mocks.revokeEarnedPointsWithin,
  remainingRefundableCents: (order: { totalCents: number; refundedTotalCents?: number }) =>
    Math.max(0, order.totalCents - (order.refundedTotalCents ?? 0)),
}));
vi.mock("@/lib/inventory/reservations", () => ({
  releaseInventoryHoldsWithin: mocks.releaseInventoryHoldsWithin,
  retainInventoryHoldsAfterPaymentWithin: mocks.retainInventoryHoldsAfterPaymentWithin,
}));

import { applySquareEvent, claimEvent } from "./apply";

function insertDb(rows: { id: string }[]) {
  const builder = {
    values: vi.fn(() => builder),
    onConflictDoNothing: vi.fn(() => builder),
    returning: vi.fn(async () => rows),
  };
  return { insert: vi.fn(() => builder) };
}

function updateDb(rows: { id: string }[], captureWhere?: (query: unknown) => void) {
  const builder = {
    set: vi.fn(() => builder),
    where: vi.fn((query: unknown) => {
      captureWhere?.(query);
      return builder;
    }),
    returning: vi.fn(async () => rows),
  };
  return { update: vi.fn(() => builder) };
}

function selectDb(processedAt: Date | null) {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn(async () => [{ processedAt }]),
  };
  return { select: vi.fn(() => builder) };
}

function selectRowsDb(rows: unknown[]) {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn(async () => rows),
  };
  return { select: vi.fn(() => builder) };
}

function captureUpdateDb(
  rows: { id: string }[] = [],
  captureSet?: (value: Record<string, unknown>) => void,
) {
  const builder = {
    set: vi.fn((value: Record<string, unknown>) => {
      captureSet?.(value);
      return builder;
    }),
    where: vi.fn(() => builder),
    returning: vi.fn(async () => rows),
  };
  return { update: vi.fn(() => builder) };
}

function transactionDb(
  rows: { id: string }[],
  captureSet?: (value: Record<string, unknown>) => void,
) {
  const update = captureUpdateDb(rows, captureSet);
  const tx = {
    ...update,
    delete: vi.fn(() => ({ where: vi.fn(async () => []) })),
  };
  return { transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
}

const ORDER = {
  id: "00000000-0000-4000-8000-000000000001",
  orderNumber: "PT-1001",
  squareOrderId: "SQ_ORDER_1",
  squarePaymentId: "PAY_1",
  paymentAttemptKey: null,
  paymentAttemptStartedAt: null,
  squareRefundId: null,
  refundAttemptKey: null,
  refundAttemptStartedAt: null,
  refundStatus: "not_required",
  refundError: null,
  squareSyncError: null,
  squareLocationId: "TORONTO_WEST",
  status: "paid",
  totalCents: 2400,
  refundedTotalCents: 0,
  customerAccountId: null,
  currency: "CAD",
  canceledAt: null,
};

const COMPLETED_REFUND = {
  kind: "refund" as const,
  eventId: "evt-refund",
  type: "refund.updated",
  createdAt: "2026-08-20T12:01:00Z",
  refundId: "REFUND_1",
  paymentId: "PAY_1",
  squareOrderId: "SQ_ORDER_1",
  locationId: "TORONTO_WEST",
  status: "APPROVED",
  amountCents: 2400,
  currency: "CAD",
};

const COMPLETED_PAYMENT = {
  kind: "payment" as const,
  eventId: "evt-payment",
  type: "payment.updated",
  paymentId: "PAY_1",
  squareOrderId: "SQ_ORDER_1",
  status: "COMPLETED",
  amountCents: 2400,
  currency: "CAD",
  locationId: "TORONTO_WEST",
  referenceId: "PT-1001",
};

describe("claimEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mirrorToSquare.mockResolvedValue(undefined);
  });

  it("owns a newly inserted Square event", async () => {
    mocks.db.mockReturnValueOnce(insertDb([{ id: "evt-new" }]));

    await expect(claimEvent("evt-new", "payment.updated", {})).resolves.toEqual({
      status: "claimed",
    });
    expect(mocks.db).toHaveBeenCalledTimes(1);
  });

  it("does not let a duplicate worker process an active claim", async () => {
    let leaseWhere: unknown;
    mocks.db
      .mockReturnValueOnce(insertDb([]))
      .mockReturnValueOnce(updateDb([], (query) => { leaseWhere = query; }))
      .mockReturnValueOnce(selectDb(null));

    await expect(claimEvent("evt-busy", "payment.updated", {})).resolves.toEqual({
      status: "busy",
    });

    const compiled = new PgDialect().sqlToQuery(leaseWhere as never);
    expect(compiled.sql).toContain('"webhook_events"."processed_at" is null');
    expect(compiled.sql).toContain('"webhook_events"."error" is not null');
    expect(compiled.sql).toContain('"webhook_events"."received_at" <');
  });

  it("reclaims a failed or expired attempt atomically", async () => {
    mocks.db
      .mockReturnValueOnce(insertDb([]))
      .mockReturnValueOnce(updateDb([{ id: "evt-retry" }]));

    await expect(claimEvent("evt-retry", "refund.updated", {})).resolves.toEqual({
      status: "claimed",
    });
    expect(mocks.db).toHaveBeenCalledTimes(2);
  });

  it("recognises a fully processed duplicate", async () => {
    mocks.db
      .mockReturnValueOnce(insertDb([]))
      .mockReturnValueOnce(updateDb([]))
      .mockReturnValueOnce(selectDb(new Date("2026-08-20T12:00:00Z")));

    await expect(claimEvent("evt-done", "payment.updated", {})).resolves.toEqual({
      status: "processed",
    });
  });
});

describe("applySquareEvent money reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mirrorToSquare.mockResolvedValue(undefined);
    mocks.notifyOrder.mockResolvedValue(undefined);
    mocks.notifyOrderRefund.mockResolvedValue(undefined);
    mocks.releaseInventoryHoldsWithin.mockResolvedValue(undefined);
    mocks.retainInventoryHoldsAfterPaymentWithin.mockResolvedValue(undefined);
    mocks.resolveWebhookLedgerRow.mockResolvedValue({ id: "ledger-1", status: "pending", amountCents: 2400 });
    mocks.settleLedgerRowWithin.mockResolvedValue(true);
    mocks.markLedgerRowById.mockResolvedValue(undefined);
    mocks.revokeEarnedPointsWithin.mockResolvedValue(undefined);
  });

  it("stops production for an exact full refund initiated directly in Square", async () => {
    let canceledWrite: Record<string, unknown> | undefined;
    mocks.db
      .mockReturnValueOnce(selectRowsDb([ORDER]))
      .mockReturnValueOnce(transactionDb([{ id: ORDER.id }], (value) => { canceledWrite = value; }))
      .mockReturnValueOnce(captureUpdateDb());

    await expect(applySquareEvent(COMPLETED_REFUND)).resolves.toMatchObject({
      handled: true,
    });
    expect(canceledWrite).toMatchObject({
      status: "canceled",
      refundStatus: "completed",
      squareRefundId: "REFUND_1",
    });
    expect(mocks.mirrorToSquare).toHaveBeenCalledWith("SQ_ORDER_1", "canceled");
    expect(mocks.notifyOrder).toHaveBeenCalledWith(ORDER.id, "order_canceled");
  });

  it("uses the Square order id when a refund arrives before payment reconciliation", async () => {
    let canceledWrite: Record<string, unknown> | undefined;
    const processing = {
      ...ORDER,
      status: "pending_payment",
      squarePaymentId: `PROCESSING:${ORDER.id}`,
      paymentAttemptKey: "payment-attempt-1",
      paymentAttemptSourceId: "opaque-source",
      paymentAttemptStartedAt: new Date(),
    };
    mocks.db
      .mockReturnValueOnce(selectRowsDb([]))
      .mockReturnValueOnce(selectRowsDb([processing]))
      .mockReturnValueOnce(transactionDb([{ id: ORDER.id }], (value) => { canceledWrite = value; }))
      .mockReturnValueOnce(captureUpdateDb());

    await expect(applySquareEvent(COMPLETED_REFUND)).resolves.toMatchObject({ handled: true });
    expect(canceledWrite).toMatchObject({
      status: "canceled",
      squarePaymentId: "PAY_1",
      paymentAttemptKey: null,
      paymentAttemptSourceId: null,
      refundStatus: "completed",
    });
  });

  it("defers a refund whose Square location conflicts with the stored order", async () => {
    mocks.db.mockReturnValueOnce(selectRowsDb([ORDER]));

    await expect(applySquareEvent({
      ...COMPLETED_REFUND,
      locationId: "LONDON",
    })).resolves.toEqual(expect.objectContaining({ handled: false, retryable: true }));
    expect(mocks.notifyOrder).not.toHaveBeenCalled();
  });

  it("replays terminal cancellation side effects idempotently", async () => {
    const canceled = {
      ...ORDER,
      status: "canceled",
      refundStatus: "completed",
      refundedTotalCents: 2400,
      squareRefundId: "REFUND_1",
    };
    // The ledger already counted this refund; a replay must never bump again.
    mocks.resolveWebhookLedgerRow.mockResolvedValue({ id: "ledger-1", status: "completed", amountCents: 2400 });
    mocks.db
      .mockReturnValueOnce(selectRowsDb([canceled]))
      .mockReturnValueOnce(captureUpdateDb());

    await expect(applySquareEvent(COMPLETED_REFUND)).resolves.toMatchObject({
      handled: true,
    });
    expect(mocks.mirrorToSquare).toHaveBeenCalledOnce();
    expect(mocks.notifyOrder).toHaveBeenCalledWith(ORDER.id, "order_canceled");
    expect(mocks.settleLedgerRowWithin).not.toHaveBeenCalled();
  });

  it("records a partial refund without cancelling or locking the order", async () => {
    let partialWrite: Record<string, unknown> | undefined;
    mocks.resolveWebhookLedgerRow.mockResolvedValue({ id: "ledger-1", status: "pending", amountCents: 1200 });
    mocks.db
      .mockReturnValueOnce(selectRowsDb([ORDER]))
      .mockReturnValueOnce(transactionDb([{ id: ORDER.id }], (value) => { partialWrite = value; }));

    await expect(applySquareEvent({
      ...COMPLETED_REFUND,
      amountCents: 1200,
    })).resolves.toMatchObject({ handled: true, detail: expect.stringContaining("partial") });
    expect(partialWrite).toMatchObject({ refundStatus: "partial", squareRefundId: "REFUND_1" });
    expect(mocks.settleLedgerRowWithin).toHaveBeenCalled();
    expect(mocks.notifyOrderRefund).toHaveBeenCalledWith(ORDER.id, "ledger-1");
    expect(mocks.mirrorToSquare).not.toHaveBeenCalled();
    expect(mocks.notifyOrder).not.toHaveBeenCalled();
  });

  it("keeps a completed order completed when its refund lands in full", async () => {
    let refundWrite: Record<string, unknown> | undefined;
    const pickedUp = { ...ORDER, status: "completed", customerAccountId: "acct-1" };
    mocks.db
      .mockReturnValueOnce(selectRowsDb([pickedUp]))
      .mockReturnValueOnce(transactionDb([{ id: ORDER.id }], (value) => { refundWrite = value; }));

    await expect(applySquareEvent(COMPLETED_REFUND)).resolves.toMatchObject({
      handled: true,
      detail: expect.stringContaining("final"),
    });
    expect(refundWrite).toMatchObject({ refundStatus: "completed" });
    expect(refundWrite).not.toHaveProperty("status");
    expect(mocks.revokeEarnedPointsWithin).toHaveBeenCalled();
    expect(mocks.notifyOrderRefund).toHaveBeenCalledWith(ORDER.id, "ledger-1");
    expect(mocks.releaseInventoryHoldsWithin).not.toHaveBeenCalled();
  });

  it("does not let an older refund event overwrite a newer active attempt", async () => {
    mocks.db.mockReturnValueOnce(selectRowsDb([{
      ...ORDER,
      refundStatus: "pending",
      refundAttemptKey: "refund-new",
      refundAttemptStartedAt: new Date("2026-08-20T12:02:00Z"),
    }]));

    await expect(applySquareEvent({
      ...COMPLETED_REFUND,
      status: "REJECTED",
      createdAt: "2026-08-20T12:01:00Z",
    })).resolves.toEqual(expect.objectContaining({
      handled: false,
      detail: expect.stringContaining("older attempt"),
    }));
    expect(mocks.db).toHaveBeenCalledOnce();
  });

  it("ignores a terminal update for a conflicting refund id", async () => {
    mocks.db
      .mockReturnValueOnce(selectRowsDb([{
        ...ORDER,
        refundStatus: "pending",
        refundAttemptKey: "refund-current",
        refundAttemptStartedAt: new Date("2026-08-20T12:00:00Z"),
        squareRefundId: "REFUND_CURRENT",
      }]))
      .mockReturnValueOnce(captureUpdateDb([]));

    await expect(applySquareEvent({
      ...COMPLETED_REFUND,
      refundId: "REFUND_OLD",
      status: "FAILED",
    })).resolves.toEqual(expect.objectContaining({
      handled: false,
      detail: expect.stringContaining("stale refund failure"),
    }));
  });

  it("defers a completed payment whose financial identity does not match", async () => {
    mocks.db.mockReturnValueOnce(selectRowsDb([{ ...ORDER, status: "pending_payment" }]));

    await expect(applySquareEvent({
      ...COMPLETED_PAYMENT,
      amountCents: 1200,
    })).resolves.toEqual(expect.objectContaining({ handled: false, retryable: true }));
    expect(mocks.notifyOrder).not.toHaveBeenCalled();
  });

  it("replays a matching terminal payment notification", async () => {
    mocks.db.mockReturnValueOnce(selectRowsDb([ORDER]));

    await expect(applySquareEvent(COMPLETED_PAYMENT)).resolves.toMatchObject({ handled: true });
    expect(mocks.notifyOrder).toHaveBeenCalledWith(ORDER.id, "order_paid");
  });

  it("defers a captured payment for a locally canceled unrefunded order", async () => {
    mocks.db.mockReturnValueOnce(selectRowsDb([{
      ...ORDER,
      status: "canceled",
      refundStatus: "not_required",
    }]));

    await expect(applySquareEvent(COMPLETED_PAYMENT)).resolves.toEqual(expect.objectContaining({
      handled: false,
      retryable: true,
      detail: expect.stringContaining("requires reconciliation"),
    }));
    expect(mocks.notifyOrder).not.toHaveBeenCalled();
  });

  it("defers fulfillment that arrives before payment reconciliation", async () => {
    mocks.db.mockReturnValueOnce(selectRowsDb([{
      ...ORDER,
      status: "pending_payment",
      squarePaymentId: "PROCESSING:00000000-0000-4000-8000-000000000001",
    }]));

    await expect(applySquareEvent({
      kind: "fulfillment",
      eventId: "evt-ready",
      type: "order.fulfillment.updated",
      squareOrderId: "SQ_ORDER_1",
      newState: "PREPARED",
    })).resolves.toEqual(expect.objectContaining({ handled: false, retryable: true }));
  });

  it("does not release an unpaid order while its payment marker is active", async () => {
    mocks.db.mockReturnValueOnce(selectRowsDb([{
      ...ORDER,
      status: "pending_payment",
      squarePaymentId: `PROCESSING:${ORDER.id}`,
    }]));

    await expect(applySquareEvent({
      kind: "fulfillment",
      eventId: "evt-canceled",
      type: "order.fulfillment.updated",
      squareOrderId: "SQ_ORDER_1",
      newState: "CANCELED",
    })).resolves.toEqual(expect.objectContaining({ handled: false, retryable: true }));
    expect(mocks.releaseInventoryHoldsWithin).not.toHaveBeenCalled();
  });

  it("keeps a Square-completed order ready until counter pickup is verified", async () => {
    let warningWrite: Record<string, unknown> | undefined;
    mocks.db
      .mockReturnValueOnce(selectRowsDb([{ ...ORDER, status: "ready" }]))
      .mockReturnValueOnce(captureUpdateDb([], (value) => { warningWrite = value; }));

    await expect(applySquareEvent({
      kind: "fulfillment",
      eventId: "evt-completed",
      type: "order.fulfillment.updated",
      squareOrderId: "SQ_ORDER_1",
      newState: "COMPLETED",
    })).resolves.toMatchObject({ handled: false, detail: expect.stringContaining("pickup verification") });

    expect(warningWrite).toMatchObject({
      squareSyncError: expect.stringContaining("Verify pickup"),
    });
    expect(warningWrite).not.toHaveProperty("status");
  });
});
