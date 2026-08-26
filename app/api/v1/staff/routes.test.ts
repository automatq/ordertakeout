import { beforeEach, describe, expect, it, vi } from "vitest";

import { queueResponseSchema } from "@/lib/api/dto";

const VALID_TOKEN = "device-1.9999999999999.signature";

const mocks = vi.hoisted(() => ({
  getDashboardData: vi.fn(),
  serverEnv: vi.fn(() => ({ STAFF_DASHBOARD_PASSWORD: "correct-horse" })),
  consumeRateLimit: vi.fn(async () => ({ allowed: true })),
  requestFingerprint: vi.fn(async () => "test-fingerprint"),
  registerDevice: vi.fn(),
  verifyDeviceToken: vi.fn(),
  touchDevice: vi.fn(async () => {}),
  recordAudit: vi.fn(async () => {}),
}));

vi.mock("@/lib/orders/dashboard", () => ({ getDashboardData: mocks.getDashboardData }));
vi.mock("@/lib/env", () => ({ serverEnv: mocks.serverEnv }));
vi.mock("@/lib/audit/log", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/security/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  requestFingerprint: mocks.requestFingerprint,
}));
/* Stubbed at the token layer so the header parsing in lib/api/context.ts is
   still the real thing — that is what the identical-401 test is about. The
   signing, expiry and revocation logic is tested against a real database in
   lib/auth/device-session.integration.test.ts. */
vi.mock("@/lib/auth/device-session", () => ({
  registerDevice: mocks.registerDevice,
  verifyDeviceToken: mocks.verifyDeviceToken,
  touchDevice: mocks.touchDevice,
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

const validToken = async (): Promise<string> => VALID_TOKEN;

const queueRequest = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/v1/staff/orders", { headers });

beforeEach(() => {
  mocks.getDashboardData.mockReset();
  mocks.getDashboardData.mockResolvedValue(dashboardData());
  mocks.consumeRateLimit.mockClear();
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true });

  mocks.verifyDeviceToken.mockReset();
  mocks.verifyDeviceToken.mockImplementation(async (token?: string) =>
    token === VALID_TOKEN ? { deviceId: "device-1" } : null,
  );
  mocks.registerDevice.mockReset();
  mocks.registerDevice.mockResolvedValue({
    deviceId: "device-1",
    token: VALID_TOKEN,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
  });
  mocks.recordAudit.mockClear();
});

describe("GET /api/v1/staff/orders", () => {
  it("refuses every flavour of missing or bad credential identically", async () => {
    const responses = await Promise.all([
      GET(queueRequest()),
      GET(queueRequest({ authorization: "" })),
      GET(queueRequest({ authorization: "Basic abc" })),
      GET(queueRequest({ authorization: "Bearer" })),
      GET(queueRequest({ authorization: "Bearer 9999999999999.forged" })),
      // Well-formed, but the device was revoked or never existed.
      GET(queueRequest({ authorization: "Bearer device-9.9999999999999.signature" })),
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

  it("records that the device is still in use", async () => {
    await GET(queueRequest({ authorization: `Bearer ${await validToken()}` }));
    expect(mocks.touchDevice).toHaveBeenCalledWith("device-1");
  });

  it("does not fail the request when recording last-seen fails", async () => {
    // A kitchen screen should not go blank because a bookkeeping write lost.
    mocks.touchDevice.mockRejectedValueOnce(new Error("database busy"));
    const response = await GET(queueRequest({ authorization: `Bearer ${await validToken()}` }));
    expect(response.status).toBe(200);
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

  it("registers the handset so it can be revoked on its own later", async () => {
    await post({ password: "correct-horse", deviceLabel: "Counter iPad", platform: "ios" });
    expect(mocks.registerDevice).toHaveBeenCalledWith("Counter iPad", "ios");
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "staff_device.registered", entityId: "device-1" }),
    );
  });

  it("never registers a device for a failed sign-in", async () => {
    // Otherwise the device list fills with rows for people who guessed wrong.
    await post({ password: "hunter2" });
    await post({ password: "" });
    expect(mocks.registerDevice).not.toHaveBeenCalled();
  });

  it("rejects a label that is empty, blank or absurdly long", async () => {
    for (const deviceLabel of ["", "   ", "x".repeat(61)]) {
      const response = await post({ password: "correct-horse", deviceLabel });
      expect(response.status).toBe(400);
    }
    expect(mocks.registerDevice).not.toHaveBeenCalled();
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
