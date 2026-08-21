import { describe, expect, it, vi } from "vitest";

import {
  inventoryAdvisoryLockKeys,
  PAID_INVENTORY_HOLD_BUFFER_MINUTES,
  protectInventoryHoldsForPaymentWithin,
  restoreInventoryHoldsAfterPaymentAttemptWithin,
} from "./reservations";

type InventoryTransaction = Parameters<typeof protectInventoryHoldsForPaymentWithin>[0];

function paymentHoldTransaction(
  heldRows: { variationId: string; quantity: number }[],
  updatedRows = heldRows.map(({ variationId }) => ({ variationId })),
) {
  const returning = vi.fn().mockResolvedValue(updatedRows);
  const whereUpdate = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where: whereUpdate }));
  const update = vi.fn(() => ({ set }));
  const lockRows = vi.fn().mockResolvedValue(heldRows);
  const whereSelect = vi.fn(() => ({ for: lockRows }));
  const from = vi.fn(() => ({ where: whereSelect }));
  const select = vi.fn(() => ({ from }));
  const execute = vi.fn().mockResolvedValue([]);

  return {
    tx: { execute, select, update } as unknown as InventoryTransaction,
    execute,
    update,
    set,
  };
}

describe("inventory reservation configuration", () => {
  it("uses deterministic, location-scoped advisory lock keys", () => {
    const requests = [
      { variationId: "VAR-Z", quantity: 1 },
      { variationId: "VAR-A", quantity: 1 },
    ];

    expect(inventoryAdvisoryLockKeys("TORONTO", requests)).toEqual([
      "inventory:7:TORONTO:5:VAR-A",
      "inventory:7:TORONTO:5:VAR-Z",
    ]);
    expect(inventoryAdvisoryLockKeys("LONDON", requests))
      .not.toEqual(inventoryAdvisoryLockKeys("TORONTO", requests));
  });

  it("keeps paid stock reserved for a bounded Square-sync buffer", () => {
    expect(PAID_INVENTORY_HOLD_BUFFER_MINUTES).toBeGreaterThanOrEqual(2);
    expect(PAID_INVENTORY_HOLD_BUFFER_MINUTES).toBeLessThanOrEqual(10);
  });

  it("extends every live requested row before payment crosses the network", async () => {
    const fake = paymentHoldTransaction([
      { variationId: "VAR-A", quantity: 2 },
      { variationId: "VAR-B", quantity: 1 },
    ]);
    const now = new Date("2026-08-20T18:00:00.000Z");
    const protectedUntil = new Date("9999-12-31T23:59:59.999Z");

    await expect(protectInventoryHoldsForPaymentWithin(
      fake.tx,
      "order-1",
      "TORONTO",
      [
        { variationId: "VAR-A", quantity: 2 },
        { variationId: "VAR-B", quantity: 1 },
      ],
      protectedUntil,
      now,
    )).resolves.toEqual({
      ok: true,
      heldVariationIds: ["VAR-A", "VAR-B"],
    });
    expect(fake.execute).toHaveBeenCalledTimes(2);
    expect(fake.set).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: protectedUntil }));
  });

  it("refuses payment protection when any reservation already expired", async () => {
    const fake = paymentHoldTransaction([{ variationId: "VAR-A", quantity: 2 }]);

    await expect(protectInventoryHoldsForPaymentWithin(
      fake.tx,
      "order-1",
      "TORONTO",
      [
        { variationId: "VAR-A", quantity: 2 },
        { variationId: "VAR-B", quantity: 1 },
      ],
      new Date("9999-12-31T23:59:59.999Z"),
      new Date("2026-08-20T18:00:00.000Z"),
    )).resolves.toEqual({ ok: false, heldVariationIds: ["VAR-A"] });
    expect(fake.update).not.toHaveBeenCalled();
  });

  it("restores protected inventory to a finite checkout deadline after decline", async () => {
    const fake = paymentHoldTransaction([],[
      { variationId: "VAR-A" },
      { variationId: "VAR-B" },
    ]);
    const expiresAt = new Date("2026-08-20T18:10:00.000Z");

    await expect(restoreInventoryHoldsAfterPaymentAttemptWithin(
      fake.tx,
      "order-1",
      "TORONTO",
      [
        { variationId: "VAR-A", quantity: 2 },
        { variationId: "VAR-B", quantity: 1 },
      ],
      expiresAt,
    )).resolves.toBe(2);
    expect(fake.execute).toHaveBeenCalledTimes(2);
    expect(fake.set).toHaveBeenCalledWith(expect.objectContaining({ expiresAt }));
  });
});
