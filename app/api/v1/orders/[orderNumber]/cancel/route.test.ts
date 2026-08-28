import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrderByNumber: vi.fn(),
  cancellationEligibility: vi.fn(),
  advanceOrder: vi.fn(),
  consumeRateLimit: vi.fn(),
  serverEnv: vi.fn(() => ({ ORDER_ACCESS_SECRET: "order-secret" })),
}));

vi.mock("@/lib/orders/lookup", () => ({ getOrderByNumber: mocks.getOrderByNumber }));
vi.mock("@/lib/orders/cancellation", () => ({
  customerCancellationEligibility: mocks.cancellationEligibility,
}));
vi.mock("@/lib/orders/transitions", () => ({ advanceOrder: mocks.advanceOrder }));
/* Only the DB write is replaced: `rateLimitFingerprint` is what the route uses
   to derive its key, and mocking it out would stop this exercising that. */
vi.mock("@/lib/security/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/rate-limit")>()),
  consumeRateLimit: mocks.consumeRateLimit,
}));
vi.mock("@/lib/env", () => ({ serverEnv: mocks.serverEnv }));

const { POST } = await import("./route");
const { createOrderAccessToken } = await import("@/lib/orders/access");

const ORDER = { id: "order-1", orderNumber: "PT-ABC123", status: "paid" };

const call = (orderNumber: string, key?: unknown) =>
  POST(
    new Request(`http://localhost/api/v1/orders/${orderNumber}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ key }),
    }),
    { params: Promise.resolve({ orderNumber }) },
  );

beforeEach(() => {
  mocks.getOrderByNumber.mockReset();
  mocks.getOrderByNumber.mockImplementation(async (reference: string) =>
    reference === "PT-ABC123" ? ORDER : null,
  );
  mocks.cancellationEligibility.mockReset();
  mocks.cancellationEligibility.mockResolvedValue({ allowed: true, deadline: new Date() });
  mocks.advanceOrder.mockReset();
  mocks.advanceOrder.mockResolvedValue({ ok: true, status: "canceled" });
  mocks.consumeRateLimit.mockReset();
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
});

const validKey = () => createOrderAccessToken(ORDER.id, ORDER.orderNumber);

describe("POST /api/v1/orders/[orderNumber]/cancel", () => {
  it("cancels for whoever holds the order's key", async () => {
    const response = await call("PT-ABC123", validKey());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, data: { canceled: true } });
    expect(mocks.advanceOrder).toHaveBeenCalledWith("order-1", "canceled", { type: "customer" });
  });

  it("is not an oracle for which order numbers exist", async () => {
    const wrongKey = await (await call("PT-ABC123", "not-the-right-token-at-all")).json();
    const noSuchOrder = await (await call("PT-NOPE99", validKey())).json();

    expect(wrongKey).toEqual(noSuchOrder);
    expect(mocks.advanceOrder).not.toHaveBeenCalled();
  });

  it("refuses a missing key without reaching the order", async () => {
    const response = await call("PT-ABC123", undefined);

    expect(response.status).toBe(400);
    expect(mocks.getOrderByNumber).not.toHaveBeenCalled();
  });

  it("answers 429 rather than 400 when the limiter trips, so clients back off", async () => {
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });

    const response = await call("PT-ABC123", validKey());

    expect(response.status).toBe(429);
    expect(mocks.advanceOrder).not.toHaveBeenCalled();
  });

  it("passes the cutoff refusal through in the customer's own words", async () => {
    mocks.cancellationEligibility.mockResolvedValue({
      allowed: false,
      reason: "This order can no longer be cancelled online.",
    });

    const response = await call("PT-ABC123", validKey());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_request", message: "This order can no longer be cancelled online." },
    });
    expect(mocks.advanceOrder).not.toHaveBeenCalled();
  });
});
