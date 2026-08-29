import { beforeEach, describe, expect, it, vi } from "vitest";

import { pickupPreviewSchema } from "@/lib/api/dto";

const VALID_TOKEN = "device-1.9999999999999.signature";

const mocks = vi.hoisted(() => ({
  previewPickupVerification: vi.fn(),
  verifyPickup: vi.fn(),
  verifyDeviceToken: vi.fn(),
  touchDevice: vi.fn(async () => {}),
  serverEnv: vi.fn(() => ({ STORE_TIMEZONE: "America/Toronto" })),
}));

vi.mock("@/lib/env", () => ({ serverEnv: mocks.serverEnv }));

vi.mock("@/lib/orders/pickup-verification", () => ({
  previewPickupVerification: mocks.previewPickupVerification,
  verifyPickup: mocks.verifyPickup,
}));
vi.mock("@/lib/auth/device-session", () => ({
  verifyDeviceToken: mocks.verifyDeviceToken,
  touchDevice: mocks.touchDevice,
  registerDevice: vi.fn(),
}));

const { POST } = await import("./pickup/route");

const PREVIEW = {
  orderId: "order-1",
  orderNumber: "PT-ABC123",
  customerName: "Maria Santos",
  pickupDate: "2026-08-26",
  pickupTime: "16:00:00",
  pickupLocationName: "Harina — Wilson",
  itemCount: 2,
  method: "qr" as const,
};

const post = (body: unknown, auth = `Bearer ${VALID_TOKEN}`) =>
  POST(
    new Request("http://localhost/api/v1/staff/pickup", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  mocks.verifyDeviceToken.mockReset();
  mocks.verifyDeviceToken.mockImplementation(async (token?: string) =>
    token === VALID_TOKEN ? { deviceId: "device-1" } : null,
  );
  mocks.previewPickupVerification.mockReset();
  mocks.previewPickupVerification.mockResolvedValue(PREVIEW);
  mocks.verifyPickup.mockReset();
  mocks.verifyPickup.mockResolvedValue({ ok: true, orderId: "order-1", orderNumber: "PT-ABC123" });
});

describe("POST /api/v1/staff/pickup", () => {
  it("needs a device token", async () => {
    const response = await post({ intent: "preview", method: "qr", value: "pass" }, "");
    expect(response.status).toBe(401);
    expect(mocks.previewPickupVerification).not.toHaveBeenCalled();
  });

  it("returns a preview through the DTO", async () => {
    const response = await post({ intent: "preview", method: "qr", value: "pass-string" });
    expect(response.status).toBe(200);

    const { data } = await response.json();
    expect(data.found).toBe(true);
    expect(() => pickupPreviewSchema.parse(data.order)).not.toThrow();
    // Postgres hands back HH:mm:ss; the wire format is HH:mm.
    expect(data.order.pickupTime).toBe("16:00");
    /* The store's today, so a tablet with a wrong clock cannot label a pickup
       "Today" that is not. */
    expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("passes the scanned string through untouched", async () => {
    /* Parsing and signature checking belong on the server. If the app ever
       started splitting the pass apart, a patched build could hand over a
       forged one. */
    const pass = "PT-ABC123.c29tZS1zaWduYXR1cmU";
    await post({ intent: "preview", method: "qr", value: pass });
    expect(mocks.previewPickupVerification).toHaveBeenCalledWith({
      intent: "preview",
      method: "qr",
      value: pass,
    });
  });

  it("reports a refusal as a 200 the counter can read", async () => {
    // "This order was cancelled" is for the person at the counter, not a client
    // error — a 4xx would claim the request was malformed.
    mocks.previewPickupVerification.mockResolvedValue({
      ok: false,
      reason: "This order was cancelled and cannot be collected.",
    });
    const response = await post({ intent: "preview", method: "qr", value: "pass" });
    expect(response.status).toBe(200);

    const { data } = await response.json();
    expect(data).toEqual({
      found: false,
      reason: "This order was cancelled and cannot be collected.",
    });
  });

  it("confirms collection with the initials of whoever handed it over", async () => {
    const response = await post({
      intent: "confirm",
      method: "qr",
      value: "pass",
      staffInitials: "MS",
    });
    expect(response.status).toBe(200);
    expect(mocks.verifyPickup).toHaveBeenCalledWith(
      expect.objectContaining({ method: "qr", value: "pass", staffInitials: "MS" }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: { verified: true, orderNumber: "PT-ABC123" },
    });
  });

  it("surfaces a Square sync warning rather than swallowing it", async () => {
    /* The order is handed over either way, so staff have to know the books will
       disagree until it syncs. */
    mocks.verifyPickup.mockResolvedValue({
      ok: true,
      orderId: "order-1",
      orderNumber: "PT-ABC123",
      squareWarning: "Square did not record the collection.",
    });
    const { data } = await (await post({
      intent: "confirm",
      method: "qr",
      value: "pass",
      staffInitials: "MS",
    })).json();
    expect(data.squareWarning).toBe("Square did not record the collection.");
  });

  it("refuses to confirm without initials", async () => {
    for (const staffInitials of [undefined, "", "   ", "x".repeat(13)]) {
      const response = await post({ intent: "confirm", method: "qr", value: "pass", staffInitials });
      expect(response.status).toBe(400);
    }
    expect(mocks.verifyPickup).not.toHaveBeenCalled();
  });

  it("cannot confirm by dressing up a preview", async () => {
    // The discriminated union is what keeps these two apart; a client that sent
    // intent:"preview" with initials must not skip the name check.
    await post({ intent: "preview", method: "qr", value: "pass", staffInitials: "MS" });
    expect(mocks.verifyPickup).not.toHaveBeenCalled();
    expect(mocks.previewPickupVerification).toHaveBeenCalled();
  });

  it("rejects an unknown intent, an unknown method and an oversized value", async () => {
    for (const body of [
      { intent: "delete", method: "qr", value: "pass" },
      { intent: "preview", method: "nfc", value: "pass" },
      { intent: "preview", method: "qr", value: "x".repeat(501) },
      { intent: "preview", method: "qr", value: "" },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
  });
});
