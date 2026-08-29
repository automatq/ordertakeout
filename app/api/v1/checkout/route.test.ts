import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ startCheckout: vi.fn() }));
vi.mock("@/app/actions/checkout", () => ({ startCheckout: mocks.startCheckout }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("https://example.test/api/v1/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/checkout", () => {
  beforeEach(() => mocks.startCheckout.mockReset());

  it("keeps validation detail useful without leaking the internal failure shape", async () => {
    mocks.startCheckout.mockResolvedValue({
      ok: false,
      failure: { kind: "invalid_input", fieldErrors: { customer: ["Enter a name."] } },
    });

    const response = await POST(request({}));
    await expect(response.json()).resolves.toEqual({ ok: false, error: { code: "invalid_request", message: "Enter a name." } });
  });

  it("maps a rate limit to a retryable public response", async () => {
    mocks.startCheckout.mockResolvedValue({ ok: false, failure: { kind: "rate_limited" } });

    const response = await POST(request({}));
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code: "rate_limited", message: "Too many attempts. Wait a few minutes and try again." },
    });
  });

  it("returns only the reservation fields a mobile client needs", async () => {
    const holdExpiresAt = new Date("2026-08-29T15:00:00.000Z");
    mocks.startCheckout.mockResolvedValue({
      ok: true,
      orderId: "order-id",
      orderNumber: "PT-123456",
      subtotalCents: 1000,
      taxCents: 130,
      totalCents: 1130,
      currency: "CAD",
      holdExpiresAt,
      reservationToken: "reservation-token",
    });

    const response = await POST(request({ cart: [] }));
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        orderId: "order-id",
        orderNumber: "PT-123456",
        subtotalCents: 1000,
        taxCents: 130,
        totalCents: 1130,
        currency: "CAD",
        holdExpiresAt: holdExpiresAt.toISOString(),
        reservationToken: "reservation-token",
      },
    });
  });
});
