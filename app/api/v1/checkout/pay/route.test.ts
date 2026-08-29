import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ completeCheckout: vi.fn() }));
vi.mock("@/app/actions/checkout", () => ({ completeCheckout: mocks.completeCheckout }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("https://example.test/api/v1/checkout/pay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/checkout/pay", () => {
  beforeEach(() => mocks.completeCheckout.mockReset());

  it("does not present a throttled payment as invalid card data", async () => {
    mocks.completeCheckout.mockResolvedValue({ ok: false, code: "RATE_LIMITED", message: "Wait before trying again." });

    const response = await POST(request({}));
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code: "rate_limited", message: "Wait before trying again." },
    });
  });

  it("returns just the completed order reference and tracking credential", async () => {
    mocks.completeCheckout.mockResolvedValue({ ok: true, orderNumber: "PT-123456", accessToken: "tracking-token" });

    const response = await POST(request({ sourceId: "cnon:token" }));
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { orderNumber: "PT-123456", accessToken: "tracking-token" },
    });
  });
});
