import { beforeEach, describe, expect, it, vi } from "vitest";

const orderMocks = vi.hoisted(() => ({
  abandonOrder: vi.fn(),
  createPendingOrder: vi.fn(),
  payForOrder: vi.fn(),
}));
const securityMocks = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  requestFingerprint: vi.fn(),
}));
const locationMocks = vi.hoisted(() => ({
  getStoreLocation: vi.fn(),
}));
const accessMocks = vi.hoisted(() => ({
  verifyOrderAccessToken: vi.fn(),
}));

vi.mock("@/lib/orders/create", () => orderMocks);
vi.mock("@/lib/security/rate-limit", () => securityMocks);
vi.mock("@/lib/locations/server", () => locationMocks);
vi.mock("@/lib/orders/access", () => accessMocks);

import {
  abandonCheckout,
  completeCheckout,
  getCartAvailability,
  startCheckout,
} from "./checkout";

describe("startCheckout location binding", () => {
  beforeEach(() => {
    orderMocks.createPendingOrder.mockReset();
    securityMocks.consumeRateLimit.mockReset();
    securityMocks.requestFingerprint.mockReset();
    locationMocks.getStoreLocation.mockReset();
    accessMocks.verifyOrderAccessToken.mockReset();
    orderMocks.abandonOrder.mockReset();
    securityMocks.consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    securityMocks.requestFingerprint.mockResolvedValue("visitor");
    locationMocks.getStoreLocation.mockResolvedValue({ id: "toronto-east" });
    accessMocks.verifyOrderAccessToken.mockReturnValue(true);
  });

  it("returns the server-validated order with the location used to reserve it", async () => {
    const holdExpiresAt = new Date("2026-08-20T18:00:00.000Z");
    orderMocks.createPendingOrder.mockResolvedValue({
      ok: true,
      orderId: "2b62fc3f-fb87-4a91-9844-27832d25ec68",
      orderNumber: "PT-LOCATION",
      subtotalCents: 4500,
      taxCents: 585,
      totalCents: 5085,
      currency: "CAD",
      holdExpiresAt,
      reservationToken: "signed-reservation-token",
    });

    const result = await startCheckout({
      locationId: "toronto-east",
      cart: [{ variantId: "VAR_HOPIA_60", quantity: 1 }],
      pickup: { date: "2026-08-22", time: "14:00" },
      customer: {
        name: "Maria Santos",
        email: "maria@example.com",
        phone: "416-555-0100",
      },
      expectedTotalCents: 4500,
    });

    expect(result).toMatchObject({
      ok: true,
      orderId: "2b62fc3f-fb87-4a91-9844-27832d25ec68",
      locationId: "toronto-east",
      reservationToken: "signed-reservation-token",
    });
    expect(orderMocks.createPendingOrder).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: "toronto-east" }),
    );
  });

  it("does not expose exact Square stock counts to the browser", async () => {
    orderMocks.createPendingOrder.mockResolvedValue({
      ok: false,
      failure: {
        kind: "insufficient_stock",
        shortages: [{ variantId: "VAR_HOPIA_60", requested: 3, available: 1 }],
      },
    });

    const result = await startCheckout({
      locationId: "toronto-east",
      cart: [{ variantId: "VAR_HOPIA_60", quantity: 3 }],
      pickup: { date: "2026-08-22", time: "14:00" },
      customer: {
        name: "Maria Santos",
        email: "maria@example.com",
        phone: "416-555-0100",
      },
      expectedTotalCents: 13_500,
    });

    expect(result).toEqual({ ok: false, failure: { kind: "insufficient_stock" } });
  });

  it("rejects excess reservation attempts before creating another hold", async () => {
    securityMocks.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });

    const result = await startCheckout({
      locationId: "toronto-east",
      cart: [{ variantId: "VAR_HOPIA_60", quantity: 1 }],
      pickup: { date: "2026-08-22", time: "14:00" },
      customer: {
        name: "Maria Santos",
        email: "maria@example.com",
        phone: "416-555-0100",
      },
      expectedTotalCents: 4500,
    });

    expect(result).toEqual({ ok: false, failure: { kind: "rate_limited" } });
    expect(orderMocks.createPendingOrder).not.toHaveBeenCalled();
  });

  it("rate-limits availability before loading catalog, inventory, or scheduling data", async () => {
    securityMocks.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });

    await expect(getCartAvailability(
      [{ variantId: "VAR_HOPIA_60", quantity: 1 }],
      "toronto-east",
    )).resolves.toEqual({ ok: false, problem: { kind: "catalog_unavailable" } });
    expect(securityMocks.consumeRateLimit).toHaveBeenCalledWith(
      "checkout-availability",
      "visitor",
      { attempts: 30, windowMs: 60_000 },
    );
  });

  it("rate-limits payment before calling the order payment boundary", async () => {
    securityMocks.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });

    await expect(completeCheckout({
      orderId: "2b62fc3f-fb87-4a91-9844-27832d25ec68",
      sourceId: "cnon:card-token",
    })).resolves.toEqual({
      ok: false,
      code: "RATE_LIMITED",
      message: "Too many payment attempts. Wait a few minutes before trying again.",
    });
    expect(orderMocks.payForOrder).not.toHaveBeenCalled();
  });

  it("rejects an oversized opaque payment source before it reaches persistence", async () => {
    await expect(completeCheckout({
      orderId: "2b62fc3f-fb87-4a91-9844-27832d25ec68",
      sourceId: "x".repeat(513),
    })).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      message: "Payment details were incomplete.",
    });
    expect(orderMocks.payForOrder).not.toHaveBeenCalled();
  });

  it("releases an owned unpaid reservation before editing", async () => {
    orderMocks.abandonOrder.mockResolvedValue({ outcome: "canceled" });

    await expect(abandonCheckout({
      orderId: "2b62fc3f-fb87-4a91-9844-27832d25ec68",
      orderNumber: "PT-LOCATION",
      reservationToken: "signed-reservation-token",
    })).resolves.toEqual({ ok: true, outcome: "canceled" });
    expect(accessMocks.verifyOrderAccessToken).toHaveBeenCalledWith(
      "2b62fc3f-fb87-4a91-9844-27832d25ec68",
      "PT-LOCATION",
      "signed-reservation-token",
    );
    expect(orderMocks.abandonOrder).toHaveBeenCalledWith(
      "2b62fc3f-fb87-4a91-9844-27832d25ec68",
    );
  });

  it("preserves a reservation while its payment outcome is still resolving", async () => {
    orderMocks.abandonOrder.mockResolvedValue({ outcome: "payment_in_progress" });

    await expect(abandonCheckout({
      orderId: "2b62fc3f-fb87-4a91-9844-27832d25ec68",
      orderNumber: "PT-LOCATION",
      reservationToken: "signed-reservation-token",
    })).resolves.toEqual({ ok: true, outcome: "payment_in_progress" });
  });

  it("does not release a reservation without its signed token", async () => {
    accessMocks.verifyOrderAccessToken.mockReturnValue(false);

    await expect(abandonCheckout({
      orderId: "2b62fc3f-fb87-4a91-9844-27832d25ec68",
      orderNumber: "PT-LOCATION",
      reservationToken: "forged-token",
    })).resolves.toEqual({ ok: false });
    expect(orderMocks.abandonOrder).not.toHaveBeenCalled();
    expect(securityMocks.consumeRateLimit).not.toHaveBeenCalled();
  });
});
