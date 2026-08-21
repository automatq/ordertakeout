import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  protectInventoryHoldsForPaymentWithin: vi.fn(),
  restoreInventoryHoldsAfterPaymentAttemptWithin: vi.fn(),
  releaseInventoryHoldsWithin: vi.fn(),
  cancelSquarePaymentAttempt: vi.fn(),
  createSquarePayment: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/catalog/server", () => ({ getOrderableProducts: vi.fn() }));
vi.mock("@/lib/locations/server", () => ({ getStoreLocation: vi.fn() }));
vi.mock("@/lib/inventory/server", () => ({
  getFreshInventoryQuantities: vi.fn(),
  getFreshRawInventoryQuantities: vi.fn(),
}));
vi.mock("@/lib/inventory/reservations", () => ({
  protectInventoryHoldsForPaymentWithin: mocks.protectInventoryHoldsForPaymentWithin,
  restoreInventoryHoldsAfterPaymentAttemptWithin:
    mocks.restoreInventoryHoldsAfterPaymentAttemptWithin,
  releaseInventoryHoldsWithin: mocks.releaseInventoryHoldsWithin,
  reserveInventoryWithin: vi.fn(),
  retainInventoryHoldsAfterPaymentWithin: vi.fn(),
  subtractActiveInventoryHolds: vi.fn(),
}));
vi.mock("@/lib/scheduling/queries", () => ({ reserveSlotWithin: vi.fn() }));
vi.mock("@/lib/square/orders", () => ({
  cancelSquarePaymentAttempt: mocks.cancelSquarePaymentAttempt,
  createSquareDraftOrder: vi.fn(),
  createSquarePayment: mocks.createSquarePayment,
}));
vi.mock("@/lib/notifications/dispatch", () => ({ notifyOrder: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

import type { orders } from "@/lib/db/schema";

import {
  abandonOrder,
  claimPaymentAttempt,
  payForOrder,
  recoverStalePaymentAttempts,
  restoreAfterDefinitivePaymentFailure,
} from "./create";
import { paymentAttemptMarker } from "./payment-state";

type Order = typeof orders.$inferSelect;

const ORDER_ID = "834f116a-27bc-4d92-9f69-a5e6b2b85a91";
const ITEMS = [{ variationId: "VAR-A", quantity: 1 }];

function pendingOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    orderNumber: "PT-LEASE",
    squareLocationId: "TORONTO",
    pickupDate: "2026-08-24",
    pickupTime: "14:00",
    squarePaymentId: null,
    paymentAttemptKey: null,
    paymentAttemptSourceId: null,
    paymentAttemptStartedAt: null,
    ...overrides,
  } as Order;
}

function mutation(returned: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returned);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  return { builder: { set }, set, where, returning };
}

function slotSelection(row: { id: string; expiresAt: Date; createdAt: Date } | undefined) {
  const lock = vi.fn().mockResolvedValue(row ? [row] : []);
  const limit = vi.fn(() => ({ for: lock }));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  return { builder: { from }, lock };
}

function currentOrderSelection<T extends object>(row: T | undefined) {
  const limit = vi.fn().mockResolvedValue(row ? [row] : []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  return { builder: { from } };
}

function rowsSelection<T extends object>(rows: T[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn(() => ({ where }));
  return { builder: { from } };
}

describe("payment-bound reservation lifecycle", () => {
  beforeEach(() => {
    mocks.db.mockReset();
    mocks.protectInventoryHoldsForPaymentWithin.mockReset();
    mocks.restoreInventoryHoldsAfterPaymentAttemptWithin.mockReset();
    mocks.releaseInventoryHoldsWithin.mockReset();
    mocks.cancelSquarePaymentAttempt.mockReset();
    mocks.createSquarePayment.mockReset();
  });

  it("protects pickup and inventory holds before returning a new payment claim", async () => {
    const orderClaim = mutation([{ id: ORDER_ID }]);
    const slotExtension = mutation([{ id: "hold-1" }]);
    const slot = slotSelection({
      id: "hold-1",
      createdAt: new Date("2026-08-20T18:00:00.000Z"),
      expiresAt: new Date("2026-08-20T18:10:00.000Z"),
    });
    const tx = {
      update: vi.fn()
        .mockReturnValueOnce(orderClaim.builder)
        .mockReturnValueOnce(slotExtension.builder),
      select: vi.fn(() => slot.builder),
      execute: vi.fn().mockResolvedValue([]),
    };
    mocks.db.mockReturnValue({ transaction: (callback: (value: typeof tx) => unknown) => callback(tx) });
    mocks.protectInventoryHoldsForPaymentWithin.mockResolvedValue({
      ok: true,
      heldVariationIds: ["VAR-A"],
    });

    const result = await claimPaymentAttempt(pendingOrder(), ITEMS, "source-new");

    expect(result?.attemptKey).toMatch(/^payment-[0-9a-f-]{36}$/);
    expect(result?.paymentMarker).toBe(paymentAttemptMarker(ORDER_ID));
    expect(result?.sourceId).toBe("source-new");
    expect(result?.checkoutExpiresAt).toEqual(new Date("2026-08-20T18:10:00.000Z"));
    expect(orderClaim.set).toHaveBeenCalledWith(expect.objectContaining({
      squarePaymentId: paymentAttemptMarker(ORDER_ID),
      paymentAttemptKey: result?.attemptKey,
      paymentAttemptSourceId: "source-new",
      paymentAttemptStartedAt: expect.any(Date),
    }));
    expect(mocks.protectInventoryHoldsForPaymentWithin).toHaveBeenCalledWith(
      tx,
      ORDER_ID,
      "TORONTO",
      ITEMS,
      new Date("9999-12-31T23:59:59.999Z"),
      expect.any(Date),
    );
    expect(slotExtension.set).toHaveBeenCalledWith({
      expiresAt: new Date("9999-12-31T23:59:59.999Z"),
    });
  });

  it("reuses the persisted key and original deadline for an ambiguous retry", async () => {
    const orderClaim = mutation([{ id: ORDER_ID }]);
    const slotExtension = mutation([{ id: "hold-1" }]);
    const slot = slotSelection({
      id: "hold-1",
      createdAt: new Date("2026-08-20T18:00:00.000Z"),
      expiresAt: new Date("9999-12-31T23:59:59.999Z"),
    });
    const tx = {
      update: vi.fn()
        .mockReturnValueOnce(orderClaim.builder)
        .mockReturnValueOnce(slotExtension.builder),
      select: vi.fn(() => slot.builder),
      execute: vi.fn().mockResolvedValue([]),
    };
    mocks.db.mockReturnValue({ transaction: (callback: (value: typeof tx) => unknown) => callback(tx) });
    mocks.protectInventoryHoldsForPaymentWithin.mockResolvedValue({
      ok: true,
      heldVariationIds: ["VAR-A"],
    });

    const result = await claimPaymentAttempt(pendingOrder({
      squarePaymentId: paymentAttemptMarker(ORDER_ID),
      paymentAttemptKey: "payment-existing",
      paymentAttemptSourceId: "source-original",
      paymentAttemptStartedAt: new Date("2026-08-20T17:00:00.000Z"),
    }), ITEMS, "source-new-ignored");

    expect(result).toMatchObject({
      attemptKey: "payment-existing",
      sourceId: "source-original",
      checkoutExpiresAt: new Date("2026-08-20T18:10:00.000Z"),
    });
    expect(orderClaim.set).toHaveBeenCalledWith(expect.objectContaining({
      paymentAttemptKey: "payment-existing",
      paymentAttemptSourceId: "source-original",
    }));
  });

  it("replays an ambiguous Square request with its original persisted source", async () => {
    const order = pendingOrder({
      status: "pending_payment",
      squareOrderId: "SQ_ORDER",
      squarePaymentId: paymentAttemptMarker(ORDER_ID),
      paymentAttemptKey: "payment-existing",
      paymentAttemptSourceId: "source-original",
      paymentAttemptStartedAt: new Date("2026-08-20T17:00:00.000Z"),
      totalCents: 4500,
      currency: "CAD",
      customerEmail: "maria@example.com",
    });
    const orderRead = currentOrderSelection(order);
    const itemRead = rowsSelection(ITEMS);
    const orderClaim = mutation([{ id: ORDER_ID }]);
    const slotExtension = mutation([{ id: "hold-1" }]);
    const slot = slotSelection({
      id: "hold-1",
      createdAt: new Date("2026-08-20T18:00:00.000Z"),
      expiresAt: new Date("9999-12-31T23:59:59.999Z"),
    });
    const tx = {
      update: vi.fn()
        .mockReturnValueOnce(orderClaim.builder)
        .mockReturnValueOnce(slotExtension.builder),
      select: vi.fn(() => slot.builder),
      execute: vi.fn().mockResolvedValue([]),
    };
    mocks.db
      .mockReturnValueOnce({ select: vi.fn(() => orderRead.builder) })
      .mockReturnValueOnce({ select: vi.fn(() => itemRead.builder) })
      .mockReturnValueOnce({
        transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
      });
    mocks.protectInventoryHoldsForPaymentWithin.mockResolvedValue({
      ok: true,
      heldVariationIds: ["VAR-A"],
    });
    mocks.createSquarePayment.mockResolvedValue({
      ok: false,
      code: "PAYMENT_PENDING",
      message: "Still processing",
    });

    await expect(payForOrder(ORDER_ID, "source-new-ignored")).resolves.toMatchObject({
      ok: false,
      code: "PAYMENT_PENDING",
      reservationProtected: true,
    });
    expect(mocks.createSquarePayment).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "payment-existing",
      sourceId: "source-original",
    }));
  });

  it("rolls a definitive decline back to the finite checkout deadline", async () => {
    const orderRelease = mutation([{ id: ORDER_ID }]);
    const slotRestore = mutation([{ id: "hold-1" }]);
    const tx = {
      update: vi.fn()
        .mockReturnValueOnce(orderRelease.builder)
        .mockReturnValueOnce(slotRestore.builder),
    };
    mocks.db.mockReturnValue({ transaction: (callback: (value: typeof tx) => unknown) => callback(tx) });
    mocks.restoreInventoryHoldsAfterPaymentAttemptWithin.mockResolvedValue(1);
    const checkoutExpiresAt = new Date(Date.now() + 60_000);

    await expect(restoreAfterDefinitivePaymentFailure(
      ORDER_ID,
      "TORONTO",
      ITEMS,
      {
        attemptKey: "payment-declined",
        sourceId: "source-declined",
        paymentMarker: paymentAttemptMarker(ORDER_ID),
        checkoutExpiresAt,
      },
    )).resolves.toBe(checkoutExpiresAt);
    expect(orderRelease.set).toHaveBeenCalledWith(expect.objectContaining({
      squarePaymentId: null,
      paymentAttemptKey: null,
      paymentAttemptSourceId: null,
      paymentAttemptStartedAt: null,
    }));
    expect(slotRestore.set).toHaveBeenCalledWith({ expiresAt: checkoutExpiresAt });
    expect(mocks.restoreInventoryHoldsAfterPaymentAttemptWithin).toHaveBeenCalled();
  });

  it("deletes both holds when a definitive decline returns after the checkout deadline", async () => {
    const orderRelease = mutation([{ id: ORDER_ID }]);
    const deleteWhere = vi.fn().mockResolvedValue([]);
    const tx = {
      update: vi.fn(() => orderRelease.builder),
      delete: vi.fn(() => ({ where: deleteWhere })),
    };
    mocks.db.mockReturnValue({ transaction: (callback: (value: typeof tx) => unknown) => callback(tx) });
    mocks.releaseInventoryHoldsWithin.mockResolvedValue(1);

    await expect(restoreAfterDefinitivePaymentFailure(
      ORDER_ID,
      "TORONTO",
      ITEMS,
      {
        attemptKey: "payment-declined",
        sourceId: "source-declined",
        paymentMarker: paymentAttemptMarker(ORDER_ID),
        checkoutExpiresAt: new Date(Date.now() - 60_000),
      },
    )).resolves.toBeUndefined();
    expect(deleteWhere).toHaveBeenCalledOnce();
    expect(mocks.releaseInventoryHoldsWithin).toHaveBeenCalledWith(tx, ORDER_ID);
    expect(mocks.restoreInventoryHoldsAfterPaymentAttemptWithin).not.toHaveBeenCalled();
  });

  it("does not report abandonment when a payment attempt owns the order", async () => {
    const orderUpdate = mutation([]);
    const current = currentOrderSelection({ status: "pending_payment" });
    const tx = {
      update: vi.fn(() => orderUpdate.builder),
      select: vi.fn(() => current.builder),
    };
    mocks.db.mockReturnValue({ transaction: (callback: (value: typeof tx) => unknown) => callback(tx) });

    await expect(abandonOrder(ORDER_ID)).resolves.toEqual({
      outcome: "payment_in_progress",
    });
    expect(mocks.releaseInventoryHoldsWithin).not.toHaveBeenCalled();
  });

  it("reports a successful atomic cancellation only after releasing both holds", async () => {
    const orderUpdate = mutation([{ id: ORDER_ID }]);
    const deleteWhere = vi.fn().mockResolvedValue([]);
    const tx = {
      update: vi.fn(() => orderUpdate.builder),
      delete: vi.fn(() => ({ where: deleteWhere })),
    };
    mocks.db.mockReturnValue({ transaction: (callback: (value: typeof tx) => unknown) => callback(tx) });
    mocks.releaseInventoryHoldsWithin.mockResolvedValue(1);

    await expect(abandonOrder(ORDER_ID)).resolves.toEqual({ outcome: "canceled" });
    expect(deleteWhere).toHaveBeenCalledOnce();
    expect(mocks.releaseInventoryHoldsWithin).toHaveBeenCalledWith(tx, ORDER_ID);
  });

  it.each([
    [undefined, "not_found"],
    [{ status: "paid" }, "already_paid"],
    [{ status: "ready" }, "already_paid"],
    [{ status: "canceled" }, "already_canceled"],
  ] as const)("reports %s as %s after losing the cancellation CAS", async (row, outcome) => {
    const orderUpdate = mutation([]);
    const current = currentOrderSelection(row);
    const tx = {
      update: vi.fn(() => orderUpdate.builder),
      select: vi.fn(() => current.builder),
    };
    mocks.db.mockReturnValue({ transaction: (callback: (value: typeof tx) => unknown) => callback(tx) });

    await expect(abandonOrder(ORDER_ID)).resolves.toEqual({ outcome });
  });

  it("releases an orphaned protected reservation only after Square confirms cancellation", async () => {
    const stale = currentOrderSelection({
      id: ORDER_ID,
      orderNumber: "PT-LEASE",
      paymentAttemptKey: "legacy-attempt-key",
      paymentAttemptSourceId: null,
      squarePaymentId: paymentAttemptMarker(ORDER_ID),
      status: "pending_payment",
    });
    const orderCancel = mutation([{ id: ORDER_ID }]);
    const deleteWhere = vi.fn().mockResolvedValue([]);
    const tx = {
      update: vi.fn(() => orderCancel.builder),
      delete: vi.fn(() => ({ where: deleteWhere })),
    };
    mocks.db
      .mockReturnValueOnce({ select: vi.fn(() => stale.builder) })
      .mockReturnValueOnce({
        transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
      });
    mocks.cancelSquarePaymentAttempt.mockResolvedValue({ ok: true });
    mocks.releaseInventoryHoldsWithin.mockResolvedValue(1);

    await expect(recoverStalePaymentAttempts()).resolves.toEqual({
      examined: 1,
      resolved: 1,
      unresolved: 0,
    });
    expect(mocks.cancelSquarePaymentAttempt).toHaveBeenCalledWith("legacy-attempt-key");
    expect(deleteWhere).toHaveBeenCalledOnce();
    expect(mocks.releaseInventoryHoldsWithin).toHaveBeenCalledWith(tx, ORDER_ID);
  });

  it("retains and reports protected holds when Square cannot confirm cancellation", async () => {
    const stale = currentOrderSelection({
      id: ORDER_ID,
      orderNumber: "PT-LEASE",
      paymentAttemptKey: "legacy-attempt-key",
      paymentAttemptSourceId: null,
      squarePaymentId: paymentAttemptMarker(ORDER_ID),
      status: "pending_payment",
    });
    mocks.db.mockReturnValueOnce({ select: vi.fn(() => stale.builder) });
    mocks.cancelSquarePaymentAttempt.mockResolvedValue({
      ok: false,
      code: "SQUARE_ERROR",
      message: "timeout",
      ambiguous: true,
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(recoverStalePaymentAttempts()).resolves.toEqual({
      examined: 1,
      resolved: 0,
      unresolved: 1,
    });
    expect(mocks.releaseInventoryHoldsWithin).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("remains unresolved"));
    error.mockRestore();
  });
});
