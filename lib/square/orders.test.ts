import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOrder: vi.fn(),
  createPayment: vi.fn(),
  cancelPaymentByIdempotencyKey: vi.fn(),
  refundPayment: vi.fn(),
}));

vi.mock("@/lib/demo/config", () => ({ isDemoMode: () => false }));
vi.mock("./client", () => ({
  squareClient: () => ({
    orders: { create: mocks.createOrder },
    payments: {
      create: mocks.createPayment,
      cancelByIdempotencyKey: mocks.cancelPaymentByIdempotencyKey,
    },
    refunds: { refundPayment: mocks.refundPayment },
  }),
  squareLocationId: () => "unused",
}));

import {
  cancelSquarePaymentAttempt,
  createSquarePayment,
  refundSquarePayment,
} from "./orders";

const PAYMENT_INPUT = {
  idempotencyKey: "payment-00000000-0000-4000-8000-000000000000",
  locationId: "TORONTO_WEST",
  orderId: "834f116a-27bc-4d92-9f69-a5e6b2b85a91",
  squareOrderId: "SQ_ORDER",
  amountCents: 4500,
  currency: "CAD",
  sourceId: "cnon:card-nonce-ok",
  buyerEmail: "maria@example.com",
  orderNumber: "PT-TEST",
};

describe("Square payment finality", () => {
  beforeEach(() => {
    mocks.createPayment.mockReset();
    mocks.cancelPaymentByIdempotencyKey.mockReset();
    mocks.createOrder.mockReset();
    mocks.refundPayment.mockReset();
  });

  it("creates the Square order at the customer-selected location", async () => {
    mocks.createOrder.mockResolvedValue({
      order: {
        id: "SQ_ORDER",
        totalMoney: { amount: 4500n, currency: "CAD" },
        totalTaxMoney: { amount: 0n, currency: "CAD" },
      },
    });
    const { createSquareDraftOrder } = await import("./orders");

    await createSquareDraftOrder({
      locationId: "LONDON",
      orderNumber: "PT-LOCATION",
      lines: [{
        product: {
          id: "ITEM_HOPIA",
          name: "Hopia Party Tray",
          description: null,
          imageIds: [],
          imageUrls: [],
          categoryId: null,
          categoryName: null,
          variants: [],
        },
        variant: {
          id: "VAR_HOPIA_60",
          name: "60 pieces",
          priceCents: 4500,
          currency: "CAD",
          sku: null,
          ordinal: 0,
        },
        quantity: 1,
        lineTotalCents: 4500,
      }],
      pickup: { date: "2026-08-24", time: "14:00" },
      customer: {
        name: "Maria Santos",
        email: "maria@example.com",
        phone: "416-555-0100",
      },
      timeZone: "America/Toronto",
    });

    expect(mocks.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      order: expect.objectContaining({ locationId: "LONDON" }),
    }));
  });

  it("adds a fixed, order-scoped discount for a redeemed reward", async () => {
    mocks.createOrder.mockResolvedValue({
      order: {
        id: "SQ_REWARD_ORDER",
        totalMoney: { amount: 3500n, currency: "CAD" },
        totalTaxMoney: { amount: 0n, currency: "CAD" },
      },
    });
    const { createSquareDraftOrder } = await import("./orders");
    await createSquareDraftOrder({
      locationId: "LONDON", orderNumber: "PT-REWARD", pickup: { date: "2026-08-24", time: "14:00" }, timeZone: "America/Toronto",
      customer: { name: "Maria Santos", email: "maria@example.com", phone: "416-555-0100" },
      rewardDiscountCents: 1000,
      lines: [{ product: { id: "ITEM", name: "Tray", description: null, imageIds: [], imageUrls: [], categoryId: null, categoryName: null, variants: [] }, variant: { id: "VAR", name: "One", priceCents: 4500, currency: "CAD", sku: null, ordinal: 0 }, quantity: 1, lineTotalCents: 4500 }],
    });
    expect(mocks.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      order: expect.objectContaining({ discounts: [expect.objectContaining({ type: "FIXED_AMOUNT", scope: "ORDER" })] }),
    }));
  });

  it("returns success only after Square reports a completed capture", async () => {
    mocks.createPayment.mockResolvedValue({ payment: { id: "PAY_1", status: "COMPLETED" } });

    await expect(createSquarePayment(PAYMENT_INPUT)).resolves.toEqual({
      ok: true,
      paymentId: "PAY_1",
      status: "COMPLETED",
    });
    expect(mocks.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: PAYMENT_INPUT.idempotencyKey,
        locationId: "TORONTO_WEST",
        orderId: "SQ_ORDER",
      }),
      { timeoutInSeconds: 30, maxRetries: 0 },
    );
  });

  it("cancels an ambiguous attempt by its persisted idempotency key", async () => {
    mocks.cancelPaymentByIdempotencyKey.mockResolvedValue({});

    await expect(cancelSquarePaymentAttempt(PAYMENT_INPUT.idempotencyKey))
      .resolves.toEqual({ ok: true });
    expect(mocks.cancelPaymentByIdempotencyKey).toHaveBeenCalledWith(
      { idempotencyKey: PAYMENT_INPUT.idempotencyKey },
      { timeoutInSeconds: 30, maxRetries: 0 },
    );
  });

  it("keeps stale attempt cancellation errors explicitly ambiguous", async () => {
    mocks.cancelPaymentByIdempotencyKey.mockRejectedValue(new Error("network timeout"));

    await expect(cancelSquarePaymentAttempt(PAYMENT_INPUT.idempotencyKey))
      .resolves.toMatchObject({ ok: false, code: "SQUARE_ERROR", ambiguous: true });
  });

  it.each(["APPROVED", "PENDING"])(
    "does not put a %s payment on the kitchen queue",
    async (status) => {
      mocks.createPayment.mockResolvedValue({ payment: { id: "PAY_1", status } });

      await expect(createSquarePayment(PAYMENT_INPUT)).resolves.toMatchObject({
        ok: false,
        code: `PAYMENT_${status}`,
      });
    },
  );

  it("preserves a pending refund status for webhook reconciliation", async () => {
    mocks.refundPayment.mockResolvedValue({ refund: { id: "REFUND_1", status: "PENDING" } });

    await expect(refundSquarePayment({
      paymentId: "PAY_1",
      amountCents: 4500,
      currency: "CAD",
      idempotencyKey: "cancel-order-1",
    })).resolves.toEqual({
      ok: true,
      refundId: "REFUND_1",
      status: "PENDING",
      disposition: "pending",
    });
  });

  it.each([
    ["APPROVED", "completed"],
    ["COMPLETED", "completed"],
    ["FAILED", "failed"],
    ["REJECTED", "failed"],
    ["FUTURE_STATUS", "unknown"],
    [undefined, "unknown"],
  ] as const)("classifies an immediate %s refund as %s", async (status, disposition) => {
    mocks.refundPayment.mockResolvedValue({ refund: { id: "REFUND_1", status } });

    await expect(refundSquarePayment({
      paymentId: "PAY_1",
      amountCents: 4500,
      currency: "CAD",
      idempotencyKey: "cancel-order-1",
    })).resolves.toMatchObject({ ok: true, status: status ?? null, disposition });
  });

  it("marks a structured client rejection definitive", async () => {
    mocks.refundPayment.mockRejectedValue({
      statusCode: 400,
      body: { errors: [{ code: "REFUND_AMOUNT_INVALID", detail: "Amount is invalid" }] },
    });

    await expect(refundSquarePayment({
      paymentId: "PAY_1",
      amountCents: 4500,
      currency: "CAD",
      idempotencyKey: "cancel-order-1",
    })).resolves.toEqual({
      ok: false,
      code: "REFUND_AMOUNT_INVALID",
      message: "Amount is invalid",
      certainty: "definitive",
    });
  });

  it.each([
    new Error("socket timed out"),
    { statusCode: 503, body: { errors: [{ code: "SERVICE_UNAVAILABLE" }] } },
    { statusCode: 408, body: { errors: [{ code: "REQUEST_TIMEOUT" }] } },
    { statusCode: 429, body: { errors: [{ code: "RATE_LIMITED" }] } },
  ])("keeps an ambiguous refund failure reconcilable", async (failure) => {
    mocks.refundPayment.mockRejectedValue(failure);

    await expect(refundSquarePayment({
      paymentId: "PAY_1",
      amountCents: 4500,
      currency: "CAD",
      idempotencyKey: "cancel-order-1",
    })).resolves.toMatchObject({ ok: false, certainty: "ambiguous" });
  });
});
