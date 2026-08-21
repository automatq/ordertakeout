import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  getOrderableProducts: vi.fn(),
  getStoreLocation: vi.fn(),
  getFreshInventoryQuantities: vi.fn(),
  getFreshRawInventoryQuantities: vi.fn(),
  subtractActiveInventoryHolds: vi.fn(),
  protectInventoryHoldsForPaymentWithin: vi.fn(),
  reserveInventoryWithin: vi.fn(),
  releaseInventoryHoldsWithin: vi.fn(),
  restoreInventoryHoldsAfterPaymentAttemptWithin: vi.fn(),
  retainInventoryHoldsAfterPaymentWithin: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/catalog/server", () => ({
  getOrderableProducts: mocks.getOrderableProducts,
}));
vi.mock("@/lib/locations/server", () => ({ getStoreLocation: mocks.getStoreLocation }));
vi.mock("@/lib/inventory/server", () => ({
  getFreshInventoryQuantities: mocks.getFreshInventoryQuantities,
  getFreshRawInventoryQuantities: mocks.getFreshRawInventoryQuantities,
}));
vi.mock("@/lib/inventory/reservations", () => ({
  subtractActiveInventoryHolds: mocks.subtractActiveInventoryHolds,
  protectInventoryHoldsForPaymentWithin: mocks.protectInventoryHoldsForPaymentWithin,
  reserveInventoryWithin: mocks.reserveInventoryWithin,
  releaseInventoryHoldsWithin: mocks.releaseInventoryHoldsWithin,
  restoreInventoryHoldsAfterPaymentAttemptWithin:
    mocks.restoreInventoryHoldsAfterPaymentAttemptWithin,
  retainInventoryHoldsAfterPaymentWithin: mocks.retainInventoryHoldsAfterPaymentWithin,
}));
vi.mock("@/lib/scheduling/queries", () => ({ reserveSlotWithin: vi.fn() }));
vi.mock("@/lib/square/orders", () => ({
  cancelSquarePaymentAttempt: vi.fn(),
  createSquareDraftOrder: vi.fn(),
  createSquarePayment: vi.fn(),
}));
vi.mock("@/lib/notifications/dispatch", () => ({ notifyOrder: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

import { createPendingOrder } from "./create";

const PRODUCT = {
  id: "ITEM_HOPIA",
  name: "Hopia Party Tray",
  description: null,
  imageIds: [],
  imageUrls: [],
  variants: [
    {
      id: "VAR_HOPIA_60",
      name: "60 pieces",
      priceCents: 4500,
      currency: "CAD",
      sku: null,
      ordinal: 0,
    },
  ],
  slug: "hopia-party-tray",
  rule: {
    productId: "ITEM_HOPIA",
    leadTimeDays: 1,
    orderCutoffTime: "18:00",
    allowedPickupTimes: ["14:00"],
    maxUnitsPerDay: null,
    isOrderable: true,
  },
  heroImageUrl: null,
  descriptionMd: null,
  sortOrder: 0,
};

const INPUT = {
  locationId: "TORONTO_WEST",
  cart: [{ variantId: "VAR_HOPIA_60", quantity: 2 }],
  pickup: { date: "2026-08-24", time: "14:00" },
  customer: {
    name: "Maria Santos",
    email: "maria@example.com",
    phone: "416-555-0100",
  },
  expectedTotalCents: 9000,
} as const;

describe("createPendingOrder location and inventory validation", () => {
  beforeEach(() => {
    mocks.db.mockReset();
    mocks.getOrderableProducts.mockReset();
    mocks.getStoreLocation.mockReset();
    mocks.getFreshInventoryQuantities.mockReset();
    mocks.getFreshRawInventoryQuantities.mockReset();
    mocks.subtractActiveInventoryHolds.mockReset();
    mocks.protectInventoryHoldsForPaymentWithin.mockReset();
    mocks.reserveInventoryWithin.mockReset();
    mocks.releaseInventoryHoldsWithin.mockReset();
    mocks.restoreInventoryHoldsAfterPaymentAttemptWithin.mockReset();
    mocks.retainInventoryHoldsAfterPaymentWithin.mockReset();
    mocks.getOrderableProducts.mockResolvedValue({
      products: [PRODUCT],
      unconfigured: [],
      skipped: [],
    });
  });

  it("rejects a location id that is not in Square's active location list", async () => {
    mocks.getStoreLocation.mockResolvedValue(null);

    await expect(createPendingOrder(INPUT)).resolves.toEqual({
      ok: false,
      failure: { kind: "catalog_unavailable" },
    });
    expect(mocks.getFreshRawInventoryQuantities).not.toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled();
  });

  it("rejects a quantity that the selected location cannot fulfill", async () => {
    mocks.getStoreLocation.mockResolvedValue({
      id: "TORONTO_WEST",
      name: "Harina Toronto West",
      address: "314 Wilson Avenue",
      city: "Toronto, ON",
      timezone: "America/Toronto",
      currency: "CAD",
      phone: null,
      businessHours: [],
      coordinates: null,
    });
    const quantities = new Map([["VAR_HOPIA_60", 1]]);
    mocks.getFreshRawInventoryQuantities.mockResolvedValue(quantities);
    mocks.subtractActiveInventoryHolds.mockResolvedValue(quantities);
    mocks.db.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
        })),
      })),
    });

    await expect(createPendingOrder(INPUT)).resolves.toEqual({
      ok: false,
      failure: {
        kind: "insufficient_stock",
        shortages: [{ variantId: "VAR_HOPIA_60", requested: 2, available: 1 }],
      },
    });
    expect(mocks.getFreshRawInventoryQuantities).toHaveBeenCalledWith(
      "TORONTO_WEST",
      ["VAR_HOPIA_60"],
    );
    expect(mocks.subtractActiveInventoryHolds).toHaveBeenCalledWith(
      "TORONTO_WEST",
      quantities,
    );
    expect(mocks.db).toHaveBeenCalledOnce();
  });
});
