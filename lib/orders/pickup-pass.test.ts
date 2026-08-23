import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  serverEnv: () => ({
    ORDER_ACCESS_SECRET: "pickup-test-secret-that-is-long-enough-to-be-safe",
    STAFF_DASHBOARD_PASSWORD: "staff-test-password",
  }),
}));

import { createOrderAccessToken } from "./access";
import {
  createPickupPass,
  parsePickupPass,
  verifyPickupPass,
} from "./pickup-pass";

const ORDER_ID = "00000000-0000-4000-8000-000000000001";
const ORDER_NUMBER = "PT-K7M2QX9D";

describe("pickup passes", () => {
  it("creates and verifies a signed pass for its exact order", () => {
    const pass = createPickupPass(ORDER_ID, ORDER_NUMBER);
    const parsed = parsePickupPass(pass);

    expect(parsed).toEqual({ orderNumber: ORDER_NUMBER, token: expect.any(String) });
    expect(parsed && verifyPickupPass(ORDER_ID, ORDER_NUMBER, parsed.token)).toBe(true);
  });

  it("rejects tampered, malformed, and wrong-order passes", () => {
    const pass = createPickupPass(ORDER_ID, ORDER_NUMBER);
    const parsed = parsePickupPass(pass)!;
    const tampered = `${pass.slice(0, -1)}${pass.endsWith("A") ? "B" : "A"}`;

    expect(parsePickupPass(tampered)).not.toBeNull();
    expect(verifyPickupPass(ORDER_ID, ORDER_NUMBER, parsePickupPass(tampered)!.token)).toBe(false);
    expect(verifyPickupPass("00000000-0000-4000-8000-000000000002", ORDER_NUMBER, parsed.token)).toBe(false);
    expect(parsePickupPass("PT-K7M2QX9D")).toBeNull();
    expect(parsePickupPass("harina-pickup:v2:PT-K7M2QX9D:token")).toBeNull();
  });

  it("uses a different signature domain than customer tracking links", () => {
    const trackingToken = createOrderAccessToken(ORDER_ID, ORDER_NUMBER);
    const pickup = parsePickupPass(createPickupPass(ORDER_ID, ORDER_NUMBER))!;

    expect(pickup.token).not.toBe(trackingToken);
    expect(verifyPickupPass(ORDER_ID, ORDER_NUMBER, trackingToken)).toBe(false);
  });
});
