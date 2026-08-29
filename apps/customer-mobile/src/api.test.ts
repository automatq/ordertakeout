import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ isOffline: vi.fn() }));
vi.mock("./online", () => ({ isOffline: mocks.isOffline }));

import { payCheckout, startCheckout } from "./api";

describe("mobile checkout API", () => {
  beforeEach(() => {
    mocks.isOffline.mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("does not make a reservation request while the phone is offline", async () => {
    mocks.isOffline.mockReturnValue(true);

    await expect(startCheckout({
      locationId: "shop", cart: [], pickup: { date: "2026-08-30", time: "10:00" },
      customer: { name: "Maria", email: "maria@example.com", phone: "+14165550142" }, expectedTotalCents: 0,
    })).resolves.toEqual({ ok: false, error: "No connection." });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends a checkout reservation only to the versioned API route", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      data: { orderId: "order", orderNumber: "PT-123456", subtotalCents: 1000, taxCents: 130, totalCents: 1130, currency: "CAD", holdExpiresAt: "2026-08-30T10:00:00.000Z", reservationToken: "hold" },
    })));

    const result = await startCheckout({
      locationId: "shop", cart: [{ variantId: "item", quantity: 1 }], pickup: { date: "2026-08-30", time: "10:00" },
      customer: { name: "Maria", email: "maria@example.com", phone: "+14165550142" }, expectedTotalCents: 1130,
    });

    expect(result).toMatchObject({ ok: true, data: { orderNumber: "PT-123456", reservationToken: "hold" } });
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v1\/checkout$/), expect.objectContaining({ method: "POST" }));
  });

  it("keeps a declined payment recoverable instead of throwing through the checkout screen", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: { code: "invalid_request", message: "Your card was declined." },
    }), { status: 400 }));

    await expect(payCheckout({ orderId: "order", sourceId: "cnon:decline" }))
      .resolves.toEqual({ ok: false, error: "Your card was declined." });
  });
});
