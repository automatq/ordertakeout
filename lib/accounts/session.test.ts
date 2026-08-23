import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  serverEnv: () => ({
    CUSTOMER_ACCOUNT_SECRET: "customer-account-test-secret-that-is-long-enough",
    ORDER_ACCESS_SECRET: "tracking-test-secret-that-is-long-enough",
    STAFF_DASHBOARD_PASSWORD: "staff-test-password",
  }),
}));

import { accountIdFromSession, createAccountSessionToken } from "./session";

const ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";
const NOW = 1_800_000_000_000;

describe("customer account sessions", () => {
  it("accepts a valid account session and rejects tampering or expiry", async () => {
    const token = await createAccountSessionToken(ACCOUNT_ID, NOW);

    await expect(accountIdFromSession(token, NOW + 1)).resolves.toBe(ACCOUNT_ID);
    await expect(accountIdFromSession(`${token}x`, NOW + 1)).resolves.toBeNull();
    await expect(accountIdFromSession(token, NOW + 181 * 24 * 60 * 60 * 1000)).resolves.toBeNull();
  });

  it("does not accept a tracking-style token as an account session", async () => {
    await expect(accountIdFromSession("tracking-token", NOW)).resolves.toBeNull();
  });
});
