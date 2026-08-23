import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  refundSquarePayment: vi.fn(),
  cancelSquarePaymentAttempt: vi.fn(),
  notifyOrder: vi.fn(),
  releaseInventoryHoldsWithin: vi.fn(),
}));

vi.mock("next/server", () => ({ after: (callback: () => unknown) => callback() }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/demo/config", () => ({ isDemoMode: () => true }));
vi.mock("@/lib/square/orders", () => ({
  refundSquarePayment: mocks.refundSquarePayment,
  cancelSquarePaymentAttempt: mocks.cancelSquarePaymentAttempt,
}));
vi.mock("@/lib/square/client", () => ({ squareClient: vi.fn() }));
vi.mock("@/lib/notifications/dispatch", () => ({ notifyOrder: mocks.notifyOrder }));
vi.mock("@/lib/inventory/reservations", () => ({
  releaseInventoryHoldsWithin: mocks.releaseInventoryHoldsWithin,
}));
vi.mock("@/lib/orders/payment-state", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/orders/payment-state")>(),
  createRefundAttemptKey: () => "refund-00000000-0000-4000-8000-000000000099",
}));

import { advanceOrder } from "./transitions";

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

const ATTEMPT_KEY = "refund-00000000-0000-4000-8000-000000000099";
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
  currency: "CAD",
  updatedAt: new Date("2026-08-20T12:00:00Z"),
  canceledAt: null,
};

describe("refund transition finality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notifyOrder.mockResolvedValue(undefined);
    mocks.releaseInventoryHoldsWithin.mockResolvedValue(undefined);
  });

  it.each(["FAILED", "REJECTED"])(
    "keeps the order active when Square immediately reports %s",
    async (status) => {
      let failedWrite: Record<string, unknown> | undefined;
      mocks.db
        .mockReturnValueOnce(selectRowsDb([ORDER]))
        .mockReturnValueOnce(captureUpdateDb([{ id: ORDER.id }]))
        .mockReturnValueOnce(captureUpdateDb([{ id: ORDER.id }], (value) => { failedWrite = value; }));
      mocks.refundSquarePayment.mockResolvedValue({
        ok: true,
        refundId: "REFUND_1",
        status,
        disposition: "failed",
      });

      await expect(advanceOrder(ORDER.id, "canceled")).resolves.toMatchObject({ ok: false });
      expect(failedWrite).toMatchObject({
        refundStatus: "failed",
        squareRefundId: "REFUND_1",
      });
      expect(mocks.notifyOrder).not.toHaveBeenCalled();
      expect(mocks.releaseInventoryHoldsWithin).not.toHaveBeenCalled();
    },
  );

  it("binds a pending refund without claiming cancellation is complete", async () => {
    let pendingWrite: Record<string, unknown> | undefined;
    mocks.db
      .mockReturnValueOnce(selectRowsDb([ORDER]))
      .mockReturnValueOnce(captureUpdateDb([{ id: ORDER.id }]))
      .mockReturnValueOnce(captureUpdateDb([{ id: ORDER.id }], (value) => { pendingWrite = value; }));
    mocks.refundSquarePayment.mockResolvedValue({
      ok: true,
      refundId: "REFUND_1",
      status: "PENDING",
      disposition: "pending",
    });

    await expect(advanceOrder(ORDER.id, "canceled")).resolves.toMatchObject({
      ok: true,
      status: "paid",
      notice: expect.stringContaining("still processing"),
    });
    expect(mocks.refundSquarePayment).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: ATTEMPT_KEY,
    }));
    expect(pendingWrite).toMatchObject({ squareRefundId: "REFUND_1" });
    expect(mocks.notifyOrder).not.toHaveBeenCalled();
  });

  it("cancels only after Square reports refund completion", async () => {
    let canceledWrite: Record<string, unknown> | undefined;
    mocks.db
      .mockReturnValueOnce(selectRowsDb([ORDER]))
      .mockReturnValueOnce(captureUpdateDb([{ id: ORDER.id }]))
      .mockReturnValueOnce(transactionDb([{ id: ORDER.id }], (value) => { canceledWrite = value; }))
      .mockReturnValueOnce(captureUpdateDb());
    mocks.refundSquarePayment.mockResolvedValue({
      ok: true,
      refundId: "REFUND_1",
      status: "APPROVED",
      disposition: "completed",
    });

    await expect(advanceOrder(ORDER.id, "canceled")).resolves.toMatchObject({
      ok: true,
      status: "canceled",
    });
    expect(canceledWrite).toMatchObject({
      status: "canceled",
      refundStatus: "completed",
      squareRefundId: "REFUND_1",
    });
    expect(mocks.releaseInventoryHoldsWithin).toHaveBeenCalledWith(expect.anything(), ORDER.id);
    expect(mocks.notifyOrder).toHaveBeenCalledWith(ORDER.id, "order_canceled");
  });

  it("keeps an ambiguous API failure pending under the same attempt key", async () => {
    let errorWrite: Record<string, unknown> | undefined;
    const pending = {
      ...ORDER,
      refundStatus: "pending",
      refundAttemptKey: ATTEMPT_KEY,
      refundAttemptStartedAt: new Date(),
    };
    mocks.db
      .mockReturnValueOnce(selectRowsDb([ORDER]))
      .mockReturnValueOnce(captureUpdateDb([{ id: ORDER.id }]))
      .mockReturnValueOnce(captureUpdateDb([], (value) => { errorWrite = value; }))
      .mockReturnValueOnce(selectRowsDb([pending]));
    mocks.refundSquarePayment.mockResolvedValue({
      ok: false,
      code: "SQUARE_ERROR",
      message: "socket timed out",
      certainty: "ambiguous",
    });

    await expect(advanceOrder(ORDER.id, "canceled")).resolves.toMatchObject({
      ok: true,
      status: "paid",
      notice: expect.stringContaining("delayed"),
    });
    expect(errorWrite).not.toHaveProperty("refundStatus", "failed");
    expect(mocks.refundSquarePayment).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: ATTEMPT_KEY,
    }));
  });

  it("honours webhook completion that wins before an ambiguous API response", async () => {
    const completed = {
      ...ORDER,
      status: "canceled",
      refundStatus: "completed",
      refundAttemptKey: ATTEMPT_KEY,
      squareRefundId: "REFUND_1",
    };
    mocks.db
      .mockReturnValueOnce(selectRowsDb([ORDER]))
      .mockReturnValueOnce(captureUpdateDb([{ id: ORDER.id }]))
      .mockReturnValueOnce(captureUpdateDb())
      .mockReturnValueOnce(selectRowsDb([completed]))
      .mockReturnValueOnce(captureUpdateDb());
    mocks.refundSquarePayment.mockResolvedValue({
      ok: false,
      code: "SQUARE_ERROR",
      message: "socket timed out",
      certainty: "ambiguous",
    });

    await expect(advanceOrder(ORDER.id, "canceled")).resolves.toMatchObject({
      ok: true,
      status: "canceled",
    });
    expect(mocks.notifyOrder).toHaveBeenCalledWith(ORDER.id, "order_canceled");
  });

  it("does not resurrect pending after a failure webhook wins the race", async () => {
    const failed = {
      ...ORDER,
      refundStatus: "failed",
      refundAttemptKey: ATTEMPT_KEY,
      squareRefundId: "REFUND_1",
      refundError: "Square refund REJECTED",
    };
    mocks.db
      .mockReturnValueOnce(selectRowsDb([ORDER]))
      .mockReturnValueOnce(captureUpdateDb([{ id: ORDER.id }]))
      .mockReturnValueOnce(captureUpdateDb([]))
      .mockReturnValueOnce(selectRowsDb([failed]));
    mocks.refundSquarePayment.mockResolvedValue({
      ok: true,
      refundId: "REFUND_1",
      status: "PENDING",
      disposition: "pending",
    });

    await expect(advanceOrder(ORDER.id, "canceled")).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("did not complete"),
    });
    expect(mocks.notifyOrder).not.toHaveBeenCalled();
  });

  it("rotates away from a definitive failed attempt on retry", async () => {
    const failed = {
      ...ORDER,
      refundStatus: "failed",
      refundAttemptKey: "refund-old",
      refundError: "INVALID_REQUEST: rejected",
    };
    mocks.db
      .mockReturnValueOnce(selectRowsDb([failed]))
      .mockReturnValueOnce(captureUpdateDb([{ id: ORDER.id }]))
      .mockReturnValueOnce(captureUpdateDb([{ id: ORDER.id }]));
    mocks.refundSquarePayment.mockResolvedValue({
      ok: true,
      refundId: "REFUND_2",
      status: "PENDING",
      disposition: "pending",
    });

    await advanceOrder(ORDER.id, "canceled");
    expect(mocks.refundSquarePayment).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: ATTEMPT_KEY,
    }));
  });
});

describe("pickup completion guard", () => {
  it("does not allow the generic status action to bypass counter verification", async () => {
    vi.clearAllMocks();
    await expect(advanceOrder(ORDER.id, "completed")).resolves.toEqual({
      ok: false,
      reason: "Verify pickup at the counter before completing an order.",
    });
    expect(mocks.db).not.toHaveBeenCalled();
  });
});

describe("stale payment-attempt cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.releaseInventoryHoldsWithin.mockResolvedValue(undefined);
  });

  it("cancels the Square attempt before freeing a stale protected reservation", async () => {
    const stale = {
      ...ORDER,
      status: "pending_payment",
      squarePaymentId: `PROCESSING:${ORDER.id}`,
      paymentAttemptKey: "payment-attempt-1",
      paymentAttemptStartedAt: new Date(Date.now() - 10 * 60_000),
    };
    mocks.db
      .mockReturnValueOnce(selectRowsDb([stale]))
      .mockReturnValueOnce(transactionDb([{ id: ORDER.id }]));
    mocks.cancelSquarePaymentAttempt.mockResolvedValue({ ok: true });

    await expect(advanceOrder(ORDER.id, "canceled")).resolves.toEqual({
      ok: true,
      status: "canceled",
    });
    expect(mocks.cancelSquarePaymentAttempt).toHaveBeenCalledWith("payment-attempt-1");
    expect(mocks.releaseInventoryHoldsWithin).toHaveBeenCalledOnce();
  });

  it("does not free a live payment attempt", async () => {
    const live = {
      ...ORDER,
      status: "pending_payment",
      squarePaymentId: `PROCESSING:${ORDER.id}`,
      paymentAttemptKey: "payment-attempt-1",
      paymentAttemptStartedAt: new Date(),
    };
    mocks.db.mockReturnValueOnce(selectRowsDb([live]));

    await expect(advanceOrder(ORDER.id, "canceled")).resolves.toMatchObject({ ok: false });
    expect(mocks.cancelSquarePaymentAttempt).not.toHaveBeenCalled();
    expect(mocks.releaseInventoryHoldsWithin).not.toHaveBeenCalled();
  });
});
