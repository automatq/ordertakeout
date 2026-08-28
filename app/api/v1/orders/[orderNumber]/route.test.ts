import { beforeEach, describe, expect, it, vi } from "vitest";

import { customerOrderSchema } from "@/lib/api/dto";

const mocks = vi.hoisted(() => ({
  getOrderByNumber: vi.fn(),
  cancellationEligibility: vi.fn(),
  serverEnv: vi.fn(() => ({ ORDER_ACCESS_SECRET: "order-secret", STAFF_DASHBOARD_PASSWORD: "pw" })),
}));

vi.mock("@/lib/orders/lookup", () => ({ getOrderByNumber: mocks.getOrderByNumber }));
vi.mock("@/lib/orders/cancellation", () => ({
  customerCancellationEligibility: mocks.cancellationEligibility,
}));
vi.mock("@/lib/env", () => ({ serverEnv: mocks.serverEnv }));

const { GET } = await import("./route");
const { createOrderAccessToken } = await import("@/lib/orders/access");

/** As it comes out of the database: the raw row, all of it. */
function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    orderNumber: "PT-ABC123",
    status: "paid",
    customerName: "Maria Santos",
    customerEmail: "maria@example.com",
    customerPhone: "+16475550101",
    customerAccountId: "acct-9",
    pickupDate: "2026-08-26",
    pickupTime: "16:00:00",
    pickupLocationName: "Harina — Wilson",
    pickupLocationAddress: "314 Wilson Avenue",
    pickupLocationCity: "North York, ON",
    pickupLocationPhone: "+14165550100",
    subtotalCents: 5000,
    taxCents: 650,
    tipCents: 300,
    totalCents: 5950,
    currency: "CAD",
    customerNote: "Please slice it",
    staffNote: "regular",
    // Everything a customer must never see.
    squareOrderId: "sq-order-77",
    squarePaymentId: "sq-payment-77",
    paymentAttemptKey: "attempt-key-77",
    paymentAttemptSourceId: "ccof:CARD-TOKEN-DO-NOT-LEAK",
    refundAttemptKey: "refund-key-77",
    squareSyncError: "the last sync blew up",
    items: [
      {
        nameSnapshot: "Ensaymada tray",
        quantity: 2,
        unitPriceCents: 2500,
        totalPriceCents: 5000,
        squareCatalogObjectId: "VAR-1",
      },
    ],
    ...overrides,
  };
}

const call = (orderNumber: string, key?: string) =>
  GET(
    new Request(
      `http://localhost/api/v1/orders/${orderNumber}${key ? `?key=${encodeURIComponent(key)}` : ""}`,
    ),
    { params: Promise.resolve({ orderNumber }) },
  );

const keyFor = (id: string, number: string) => createOrderAccessToken(id, number);

beforeEach(() => {
  mocks.getOrderByNumber.mockReset();
  mocks.getOrderByNumber.mockImplementation(async (reference: string) =>
    reference === "PT-ABC123" ? orderRow() : null,
  );
  mocks.cancellationEligibility.mockReset();
  mocks.cancellationEligibility.mockResolvedValue({
    allowed: true,
    deadline: new Date("2026-08-25T20:00:00Z"),
  });
});

describe("GET /api/v1/orders/[orderNumber]", () => {
  it("returns the order to whoever holds its key", async () => {
    const response = await call("PT-ABC123", keyFor("order-1", "PT-ABC123"));
    expect(response.status).toBe(200);

    const { data } = await response.json();
    expect(data.found).toBe(true);
    expect(() => customerOrderSchema.parse(data.order)).not.toThrow();
    expect(data.order).toMatchObject({ orderNumber: "PT-ABC123", tipCents: 300 });
  });

  it("passes the cancellation verdict through, reason and all", async () => {
    mocks.cancellationEligibility.mockResolvedValue({
      allowed: false,
      reason: "Please call the store to cancel this legacy order.",
    });

    const { data } = await (await call("PT-ABC123", keyFor("order-1", "PT-ABC123"))).json();
    expect(data.order.cancellation).toEqual({
      allowed: false,
      reason: "Please call the store to cancel this legacy order.",
    });
  });

  it("sends no reason when cancelling is still open", async () => {
    const { data } = await (await call("PT-ABC123", keyFor("order-1", "PT-ABC123"))).json();
    expect(data.order.cancellation).toEqual({ allowed: true, reason: null });
  });

  it("never echoes the raw row", async () => {
    const raw = JSON.stringify(await (await call("PT-ABC123", keyFor("order-1", "PT-ABC123"))).json());
    for (const secret of [
      "paymentAttemptSourceId",
      "ccof:CARD-TOKEN-DO-NOT-LEAK",
      "squarePaymentId",
      "squareSyncError",
      "staffNote",
      "regular",
      "customerEmail",
      "maria@example.com",
      "customerAccountId",
    ]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("answers identically however the lookup fails", async () => {
    /* Order numbers are short and printed on receipts. Anything that
       distinguishes "no such order" from "wrong key" turns this into an oracle
       for which ones are real. */
    const bodies = await Promise.all(
      [
        call("PT-ABC123"),
        call("PT-ABC123", "not-a-key"),
        call("PT-ABC123", keyFor("another-order", "PT-ABC123")),
        call("PT-ABC123", keyFor("order-1", "PT-OTHER1")),
        call("PT-ZZZZZZ", keyFor("order-1", "PT-ABC123")),
        call("nonsense", "x"),
      ].map(async (p) => {
        const response = await p;
        return `${response.status} ${await response.text()}`;
      }),
    );
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toBe('200 {"ok":true,"data":{"found":false}}');
  });

  it("says what today is at the shop, not on the phone", async () => {
    /* Regression: every order rendered as "Today" because the screen compared
       the pickup date against itself. The shop decides what today is — a
       customer in another timezone, or a device with a wrong clock, must not
       change which day their cake is due. */
    const { data } = await (await call("PT-ABC123", keyFor("order-1", "PT-ABC123"))).json();
    expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("normalises the pickup time Postgres returns", async () => {
    const { data } = await (await call("PT-ABC123", keyFor("order-1", "PT-ABC123"))).json();
    expect(data.order.pickupTime).toBe("16:00");
  });

  describe("the pickup pass", () => {
    const passFor = async (status: string) => {
      mocks.getOrderByNumber.mockResolvedValue(orderRow({ status }));
      const { data } = await (await call("PT-ABC123", keyFor("order-1", "PT-ABC123"))).json();
      return data.order.pickupPass;
    };

    it("is issued while there is still something to collect", async () => {
      for (const status of ["paid", "preparing", "ready"]) {
        expect(await passFor(status)).toMatch(/^harina-pickup:v1:PT-ABC123:/);
      }
    });

    it("is withheld once there is not", async () => {
      /* An unpaid order has nothing to hand over, and a collected or cancelled
         one must not keep producing a scannable code. */
      for (const status of ["pending_payment", "completed", "canceled"]) {
        expect(await passFor(status)).toBeNull();
      }
    });
  });
});
