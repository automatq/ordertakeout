import { beforeEach, describe, expect, it, vi } from "vitest";

import { queueResponseSchema } from "@/lib/api/dto";

const mocks = vi.hoisted(() => ({
  getDashboardData: vi.fn(),
  serverEnv: vi.fn(() => ({ STAFF_DASHBOARD_PASSWORD: "correct-horse" })),
  consumeRateLimit: vi.fn(async () => ({ allowed: true })),
  requestFingerprint: vi.fn(async () => "test-fingerprint"),
}));

vi.mock("@/lib/orders/dashboard", () => ({ getDashboardData: mocks.getDashboardData }));
vi.mock("@/lib/env", () => ({ serverEnv: mocks.serverEnv }));
vi.mock("@/lib/security/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  requestFingerprint: mocks.requestFingerprint,
}));

const { GET } = await import("./orders/route");
const { POST } = await import("./session/route");

/**
 * A dashboard order as it actually arrives: the raw Drizzle row, all 43 columns,
 * including a Square card token. The route must not echo any of it.
 */
function dashboardOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    orderNumber: "PT-ABC123",
    customerName: "Maria Santos",
    customerEmail: "maria@example.com",
    customerPhone: "+16475550101",
    customerAccountId: "acct-9",
    pickupDate: "2026-08-26",
    pickupTime: "16:00",
    status: "paid",
    subtotalCents: 2500,
    taxCents: 325,
    totalCents: 2825,
    currency: "CAD",
    customerNote: "Please slice it",
    staffNote: null,
    pickupLocationName: "Harina — Wilson",
    squareLocationId: "LOC-1",
    // The dangerous ones.
    squareOrderId: "sq-order-77",
    squarePaymentId: "sq-payment-77",
    paymentAttemptKey: "attempt-key-77",
    paymentAttemptSourceId: "ccof:CARD-TOKEN-DO-NOT-LEAK",
    refundAttemptKey: "refund-key-77",
    squareSyncError: "the last sync blew up",
    refundError: null,
    items: [{ nameSnapshot: "Ensaymada tray", quantity: 2 }],
    pickupVerification: null,
    ...overrides,
  };
}

function dashboardData(orders = [dashboardOrder()]) {
  return {
    today: "2026-08-26",
    newOrderCount: orders.length,
    days: [
      {
        date: "2026-08-26",
        orderCount: orders.length,
        slots: [{ time: "16:00", capacity: 30, orders }],
      },
    ],
    locations: [],
    orderingPause: {},
    inCheckout: [],
  };
}

/** A token the route will accept, signed the way the real sign-in signs it. */
async function validToken(): Promise<string> {
  const { createSessionToken } = await import("@/lib/auth/session");
  return createSessionToken("correct-horse");
}

const queueRequest = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/v1/staff/orders", { headers });

beforeEach(() => {
  mocks.getDashboardData.mockReset();
  mocks.getDashboardData.mockResolvedValue(dashboardData());
  mocks.consumeRateLimit.mockClear();
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true });
});

describe("GET /api/v1/staff/orders", () => {
  it("refuses every flavour of missing or bad credential identically", async () => {
    const responses = await Promise.all([
      GET(queueRequest()),
      GET(queueRequest({ authorization: "" })),
      GET(queueRequest({ authorization: "Basic abc" })),
      GET(queueRequest({ authorization: "Bearer" })),
      GET(queueRequest({ authorization: "Bearer 9999999999999.forged" })),
      // Correctly shaped and correctly signed, but for the wrong secret.
      GET(queueRequest({ authorization: `Bearer ${await (await import("@/lib/auth/session")).createSessionToken("wrong-secret")}` })),
    ]);

    const bodies = await Promise.all(responses.map((r) => r.text()));
    // Byte-identical: anything that distinguishes these lets a client probe.
    expect(new Set(bodies).size).toBe(1);
    expect(new Set(responses.map((r) => r.status))).toEqual(new Set([401]));
    expect(mocks.getDashboardData).not.toHaveBeenCalled();
  });

  it("accepts a lowercase scheme", async () => {
    // Some HTTP clients normalise it; rejecting would be a confusing 401.
    const response = await GET(queueRequest({ authorization: `bearer ${await validToken()}` }));
    expect(response.status).toBe(200);
  });

  it("rejects an expired token", async () => {
    const { createSessionToken } = await import("@/lib/auth/session");
    const longExpired = await createSessionToken("correct-horse", Date.now() - 90 * 24 * 60 * 60_000);
    const response = await GET(queueRequest({ authorization: `Bearer ${longExpired}` }));
    expect(response.status).toBe(401);
  });

  it("serialises through the DTO and never echoes the raw row", async () => {
    const response = await GET(queueRequest({ authorization: `Bearer ${await validToken()}` }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.ok).toBe(true);

    /* .strict() is the point: a field added by spreading a row somewhere
       downstream fails here rather than shipping to every staff phone. */
    expect(() => queueResponseSchema.parse(body.data)).not.toThrow();

    const raw = JSON.stringify(body);
    for (const secret of [
      "paymentAttemptSourceId",
      "ccof:CARD-TOKEN-DO-NOT-LEAK",
      "squarePaymentId",
      "sq-payment-77",
      "paymentAttemptKey",
      "refundAttemptKey",
      "squareSyncError",
      "the last sync blew up",
      "customerAccountId",
      "customerEmail",
      "maria@example.com",
    ]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("keeps pickup dates and times as the strings they are", async () => {
    // Round-tripping either through a Date applies a timezone and can move a
    // pickup a day. They are bare store-local strings and must stay that way.
    const response = await GET(queueRequest({ authorization: `Bearer ${await validToken()}` }));
    const { data } = await response.json();
    const order = data.days[0].slots[0].orders[0];
    expect(order.pickupDate).toBe("2026-08-26");
    expect(order.pickupTime).toBe("16:00");
  });
});

describe("POST /api/v1/staff/session", () => {
  const post = (body?: unknown) =>
    POST(
      new Request("http://localhost/api/v1/staff/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  it("issues a token the queue route accepts", async () => {
    const response = await post({ password: "correct-horse" });
    expect(response.status).toBe(200);

    const { data } = await response.json();
    const queue = await GET(queueRequest({ authorization: `Bearer ${data.token}` }));
    expect(queue.status).toBe(200);
  });

  it("rejects the wrong password without saying why", async () => {
    const response = await post({ password: "hunter2" });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.message).not.toMatch(/length|character|short|long/i);
  });

  it("rejects a malformed body before looking at any password", async () => {
    for (const body of [undefined, {}, { password: "" }, { password: 12 }]) {
      const response = await post(body);
      expect(response.status).toBe(400);
    }
  });

  it("is rate limited, unlike the polling route", async () => {
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false });
    const response = await post({ password: "correct-horse" });
    expect(response.status).toBe(429);

    /* The queue is polled every few seconds all shift and consumeRateLimit is a
       database write per call, so it deliberately has no limit. */
    mocks.consumeRateLimit.mockClear();
    await GET(queueRequest({ authorization: `Bearer ${await validToken()}` }));
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
  });
});
