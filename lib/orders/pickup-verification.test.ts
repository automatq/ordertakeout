import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  mirrorToSquare: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/orders/transitions", () => ({ mirrorToSquare: mocks.mirrorToSquare }));
vi.mock("@/lib/env", () => ({
  serverEnv: () => ({
    ORDER_ACCESS_SECRET: "pickup-test-secret-that-is-long-enough-to-be-safe",
    STAFF_DASHBOARD_PASSWORD: "staff-test-password",
  }),
}));

import { createPickupPass } from "./pickup-pass";
import { previewPickupVerification, verifyPickup } from "./pickup-verification";

const ORDER = {
  id: "00000000-0000-4000-8000-000000000001",
  orderNumber: "PT-K7M2QX9D",
  customerName: "Maria Santos",
  pickupDate: "2026-08-24",
  pickupTime: "14:00",
  pickupLocationName: "Harina — Wilson",
  squareOrderId: null,
  status: "ready",
};

function selectOrderDb(rows: unknown[]) {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn(async () => rows),
  };
  return { select: vi.fn(() => builder) };
}

function selectItemsDb(rows: unknown[]) {
  const builder = { from: vi.fn(() => builder), where: vi.fn(async () => rows) };
  return { select: vi.fn(() => builder) };
}

function transactionDb(returningRows: unknown[], captured: {
  update?: Record<string, unknown>;
  verification?: Record<string, unknown>;
}) {
  const updateBuilder = {
    set: vi.fn((value: Record<string, unknown>) => {
      captured.update = value;
      return updateBuilder;
    }),
    where: vi.fn(() => updateBuilder),
    returning: vi.fn(async () => returningRows),
  };
  const insertBuilder = {
    values: vi.fn(async (value: Record<string, unknown>) => { captured.verification = value; }),
  };
  const tx = {
    update: vi.fn(() => updateBuilder),
    insert: vi.fn(() => insertBuilder),
  };
  return { transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
}

describe("pickup verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mirrorToSquare.mockResolvedValue(undefined);
  });

  it("shows a ready order only after a valid QR pass", async () => {
    mocks.db
      .mockReturnValueOnce(selectOrderDb([ORDER]))
      .mockReturnValueOnce(selectItemsDb([{ quantity: 2 }, { quantity: 1 }]));

    await expect(previewPickupVerification({
      method: "qr",
      value: createPickupPass(ORDER.id, ORDER.orderNumber),
    })).resolves.toMatchObject({
      orderNumber: ORDER.orderNumber,
      customerName: ORDER.customerName,
      itemCount: 3,
      method: "qr",
    });
  });

  it("does not reveal an order for an invalid QR pass", async () => {
    await expect(previewPickupVerification({
      method: "qr",
      value: "harina-pickup:v1:PT-K7M2QX9D:not-a-valid-token",
    })).resolves.toEqual({ ok: false, reason: "That pickup pass could not be verified." });
    expect(mocks.db).not.toHaveBeenCalled();
  });

  it("records the manual evidence atomically while completing a ready order", async () => {
    const captured: { update?: Record<string, unknown>; verification?: Record<string, unknown> } = {};
    mocks.db
      .mockReturnValueOnce(selectOrderDb([ORDER]))
      .mockReturnValueOnce(transactionDb([{ id: ORDER.id }], captured))
      .mockReturnValueOnce({ update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) })) });

    await expect(verifyPickup({
      method: "manual",
      value: ORDER.orderNumber,
      staffInitials: "am",
    })).resolves.toMatchObject({ ok: true, orderNumber: ORDER.orderNumber });

    expect(captured.update).toMatchObject({ status: "completed" });
    expect(captured.verification).toMatchObject({
      orderId: ORDER.id,
      method: "manual",
      staffInitials: "AM",
    });
  });

  it("rejects invalid initials and a concurrent completion without writing evidence", async () => {
    await expect(verifyPickup({
      method: "manual",
      value: ORDER.orderNumber,
      staffInitials: "A",
    })).resolves.toEqual({ ok: false, reason: "Enter 2–6 staff initials." });
    expect(mocks.db).not.toHaveBeenCalled();

    const captured: { update?: Record<string, unknown>; verification?: Record<string, unknown> } = {};
    mocks.db
      .mockReturnValueOnce(selectOrderDb([ORDER]))
      .mockReturnValueOnce(transactionDb([], captured));
    await expect(verifyPickup({
      method: "manual",
      value: ORDER.orderNumber,
      staffInitials: "AM",
    })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("another staff member") });
    expect(captured.verification).toBeUndefined();
  });

  it.each(["paid", "preparing", "completed", "canceled"] as const)(
    "does not verify an order that is %s",
    async (status) => {
      mocks.db.mockReturnValueOnce(selectOrderDb([{ ...ORDER, status }]));
      await expect(previewPickupVerification({ method: "manual", value: ORDER.orderNumber })).resolves.toMatchObject({
        ok: false,
      });
    },
  );
});
