import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  serverEnv: () => ({ CUSTOMER_ACCOUNT_SECRET: "signup-secret" }),
}));

const { createSignupToken, phoneFromSignupToken } = await import("./signup-token");

const PHONE = "+14165550142";
const NOW = Date.UTC(2026, 7, 23, 12, 0, 0);

describe("signup tokens", () => {
  it("round-trips the number it attests to", async () => {
    const token = await createSignupToken(PHONE, NOW);
    expect(await phoneFromSignupToken(token, NOW)).toBe(PHONE);
  });

  it("refuses a token whose number has been swapped", async () => {
    // The whole point: a client must not be able to name its own number.
    const token = await createSignupToken(PHONE, NOW);
    const [, expiry, signature] = token.split(".");
    const forged = `+14165559999.${expiry}.${signature}`;
    expect(await phoneFromSignupToken(forged, NOW)).toBeNull();
  });

  it("expires", async () => {
    const token = await createSignupToken(PHONE, NOW);
    expect(await phoneFromSignupToken(token, NOW + 16 * 60_000)).toBeNull();
  });

  it("refuses missing, malformed and unsigned tokens", async () => {
    for (const bad of [undefined, "", "nonsense", `${PHONE}.${NOW + 60_000}`, `${PHONE}..x`]) {
      expect(await phoneFromSignupToken(bad, NOW)).toBeNull();
    }
  });

  it("refuses a payload that is not a phone number", async () => {
    // Guards the shape before the HMAC, so an account id can never be presented.
    const token = await createSignupToken("00000000-0000-4000-8000-000000000001", NOW);
    expect(await phoneFromSignupToken(token, NOW)).toBeNull();
  });
});
