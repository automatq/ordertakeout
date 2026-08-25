import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrderByNumber: vi.fn(),
  publicUrl: undefined as string | undefined,
}));

vi.mock("@/lib/orders/lookup", () => ({ getOrderByNumber: mocks.getOrderByNumber }));
vi.mock("@/lib/env", () => ({
  serverEnv: () => ({
    ORDER_ACCESS_SECRET: "test-order-access-secret",
    STAFF_DASHBOARD_PASSWORD: "unused",
    STORE_PUBLIC_URL: mocks.publicUrl,
  }),
}));

import { createOrderShortToken, orderShortCode } from "@/lib/orders/access";

import { GET } from "./route";

const ORDER = {
  id: "ef14c080-f5ef-483e-9bc0-3affd9cf2138",
  orderNumber: "PT-T8BUCXGG",
};

function request(code: string) {
  return GET(new Request(`http://localhost/o/${code}`), {
    params: Promise.resolve({ code }),
  });
}

beforeEach(() => {
  mocks.publicUrl = undefined;
  mocks.getOrderByNumber.mockReset();
  mocks.getOrderByNumber.mockResolvedValue(ORDER);
});

describe("GET /o/[code]", () => {
  it("redirects to the order with a relative path, with no public URL configured", async () => {
    // Regression: the redirect was built through orderTrackingUrl, which
    // returns null without STORE_PUBLIC_URL — so every short link 404'd in dev
    // and on previews, and pointed at the production host when it was set.
    const response = await request(orderShortCode(ORDER.id, ORDER.orderNumber));

    expect(response.status).toBe(302);
    const location = response.headers.get("Location")!;
    expect(location.startsWith("/orders/PT-T8BUCXGG?key=")).toBe(true);
    expect(location).not.toContain("http");
  });

  it("stays relative even when a public URL is configured", async () => {
    mocks.publicUrl = "https://harinabakeshoppe.com";
    const response = await request(orderShortCode(ORDER.id, ORDER.orderNumber));
    expect(response.headers.get("Location")).not.toContain("harinabakeshoppe.com");
  });

  it("sends a tampered token to lookup, not to the order", async () => {
    const response = await request(`T8BUCXGG${"x".repeat(8)}`);
    expect(response.headers.get("Location")).toBe("/orders?notfound=1");
  });

  it("gives an unknown order the same answer as a bad token", async () => {
    // Distinguishing the two would make this an order-number oracle.
    mocks.getOrderByNumber.mockResolvedValue(null);
    const valid = await request(orderShortCode(ORDER.id, ORDER.orderNumber));
    expect(valid.headers.get("Location")).toBe("/orders?notfound=1");
  });

  it("rejects a code too short to contain a token", async () => {
    const response = await request("abc");
    expect(response.headers.get("Location")).toBe("/orders?notfound=1");
    expect(mocks.getOrderByNumber).not.toHaveBeenCalled();
  });

  it("carries a working access key for the order page to verify", async () => {
    const response = await request(orderShortCode(ORDER.id, ORDER.orderNumber));
    const key = new URL(response.headers.get("Location")!, "http://localhost").searchParams.get("key");
    expect(key).toBeTruthy();
    // The short token and the page key are different secrets by design.
    expect(key).not.toBe(createOrderShortToken(ORDER.id, ORDER.orderNumber));
  });
});
