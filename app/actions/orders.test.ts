import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  advanceOrder: vi.fn(),
  consumeRateLimit: vi.fn(),
  customerCancellationEligibility: vi.fn(),
  getOrderByNumber: vi.fn(),
  requestFingerprint: vi.fn(),
  verifyOrderAccessToken: vi.fn(),
}));

vi.mock("@/lib/orders/lookup", () => ({ getOrderByNumber: mocks.getOrderByNumber }));
vi.mock("@/lib/security/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  requestFingerprint: mocks.requestFingerprint,
}));
vi.mock("@/lib/orders/access", () => ({
  createOrderAccessToken: vi.fn(),
  verifyOrderAccessToken: mocks.verifyOrderAccessToken,
}));
vi.mock("@/lib/orders/cancellation", () => ({
  customerCancellationEligibility: mocks.customerCancellationEligibility,
}));
vi.mock("@/lib/orders/transitions", () => ({ advanceOrder: mocks.advanceOrder }));

import { cancelCustomerOrder } from "./orders";

describe("cancelCustomerOrder", () => {
  const input = { orderNumber: "PT-ORDER", accessToken: "signed-access-token-12345" };

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.requestFingerprint.mockResolvedValue("visitor");
    mocks.getOrderByNumber.mockResolvedValue({ id: "order-id", orderNumber: "PT-ORDER" });
    mocks.verifyOrderAccessToken.mockReturnValue(true);
    mocks.customerCancellationEligibility.mockResolvedValue({ allowed: true });
  });

  it("does not claim cancellation succeeded while Square is still processing a refund", async () => {
    mocks.advanceOrder.mockResolvedValue({
      ok: true,
      status: "paid",
      notice: "Square accepted the refund and is still processing it.",
    });

    await expect(cancelCustomerOrder(input)).resolves.toEqual({
      ok: false,
      reason: "Square accepted the refund and is still processing it.",
    });
  });

  it("reports success only after the order is actually canceled", async () => {
    mocks.advanceOrder.mockResolvedValue({ ok: true, status: "canceled" });

    await expect(cancelCustomerOrder(input)).resolves.toEqual({ ok: true });
  });
});
