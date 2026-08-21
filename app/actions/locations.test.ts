import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStoreLocation: vi.fn(),
  getStoreLocations: vi.fn(),
  getOrderableProducts: vi.fn(),
  getInventoryQuantities: vi.fn(),
  getInStockVariationIds: vi.fn(),
  consumeRateLimit: vi.fn(),
  requestFingerprint: vi.fn(),
}));

vi.mock("@/lib/locations/server", () => ({
  getStoreLocation: mocks.getStoreLocation,
  getStoreLocations: mocks.getStoreLocations,
}));
vi.mock("@/lib/catalog/server", () => ({
  getOrderableProducts: mocks.getOrderableProducts,
}));
vi.mock("@/lib/inventory/server", () => ({
  getInventoryQuantities: mocks.getInventoryQuantities,
  getInStockVariationIds: mocks.getInStockVariationIds,
}));
vi.mock("@/lib/security/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  requestFingerprint: mocks.requestFingerprint,
}));

import {
  getPickupLocations,
  getVariantAvailability,
  reconcileCartForLocation,
} from "./locations";

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

describe("reconcileCartForLocation", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.requestFingerprint.mockResolvedValue("visitor|location");
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.getStoreLocation.mockResolvedValue({ id: "LONDON" });
    mocks.getOrderableProducts.mockResolvedValue({
      products: [PRODUCT],
      unconfigured: [],
      skipped: [],
    });
  });

  it("rejects a forged or inactive Square location before reading inventory", async () => {
    mocks.getStoreLocation.mockResolvedValue(null);

    await expect(reconcileCartForLocation({
      locationId: "INACTIVE",
      items: [{ variantId: "VAR_HOPIA_60", quantity: 1 }],
    })).resolves.toBeNull();
    expect(mocks.getInventoryQuantities).not.toHaveBeenCalled();
  });

  it("returns an explicit failure when an inventory request is rate-limited", async () => {
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });

    await expect(getVariantAvailability({
      locationId: "LONDON",
      variantIds: ["VAR_HOPIA_60"],
    })).resolves.toEqual({ ok: false });
    expect(mocks.getInventoryQuantities).not.toHaveBeenCalled();
  });

  it("returns an explicit failure when pickup-location loading is rate-limited", async () => {
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });

    await expect(getPickupLocations()).resolves.toEqual({ ok: false });
    expect(mocks.getStoreLocations).not.toHaveBeenCalled();
  });

  it("identifies and removes a quantity unavailable at the new location", async () => {
    mocks.getInventoryQuantities.mockResolvedValue(new Map([["VAR_HOPIA_60", 1]]));

    await expect(reconcileCartForLocation({
      locationId: "LONDON",
      items: [{ variantId: "VAR_HOPIA_60", quantity: 2 }],
    })).resolves.toEqual({
      retainedVariantIds: [],
      removed: [{
        variantId: "VAR_HOPIA_60",
        name: "Hopia Party Tray — 60 pieces",
        reason: "insufficient",
      }],
    });
  });

  it("combines archived items with known items sold out at the new location", async () => {
    mocks.getInventoryQuantities.mockResolvedValue(new Map([["VAR_HOPIA_60", 0]]));

    await expect(reconcileCartForLocation({
      locationId: "LONDON",
      items: [
        { variantId: "VAR_ARCHIVED", quantity: 1 },
        { variantId: "VAR_HOPIA_60", quantity: 2 },
      ],
    })).resolves.toEqual({
      retainedVariantIds: [],
      removed: [
        {
          variantId: "VAR_ARCHIVED",
          name: "Unavailable item",
          reason: "unavailable",
        },
        {
          variantId: "VAR_HOPIA_60",
          name: "Hopia Party Tray — 60 pieces",
          reason: "insufficient",
        },
      ],
    });
    expect(mocks.getInventoryQuantities).toHaveBeenCalledWith(
      "LONDON",
      ["VAR_HOPIA_60"],
    );
  });
});
