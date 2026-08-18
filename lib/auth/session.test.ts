import { describe, expect, it } from "vitest";

import { createSessionToken, safeEqual, verifySessionToken } from "./session";

const SECRET = "correct-horse-battery-staple";
const NOW = 1_800_000_000_000;
const TWELVE_HOURS = 12 * 60 * 60 * 1000;

describe("session tokens", () => {
  it("accepts a token it just issued", async () => {
    const token = await createSessionToken(SECRET, NOW);
    expect(await verifySessionToken(SECRET, token, NOW + 1000)).toBe(true);
  });

  it("expires after twelve hours", async () => {
    const token = await createSessionToken(SECRET, NOW);
    expect(await verifySessionToken(SECRET, token, NOW + TWELVE_HOURS - 1000)).toBe(true);
    expect(await verifySessionToken(SECRET, token, NOW + TWELVE_HOURS + 1000)).toBe(false);
  });

  it("rejects a token signed with a different password", async () => {
    // This is how changing the password signs everyone out.
    const token = await createSessionToken("old-password", NOW);
    expect(await verifySessionToken("new-password", token, NOW + 1000)).toBe(false);
  });

  it("rejects a forged expiry", async () => {
    // The attack this defends against: take a valid token, push the expiry out.
    const token = await createSessionToken(SECRET, NOW);
    const signature = token.slice(token.lastIndexOf(".") + 1);
    const forged = `${NOW + 10 * TWELVE_HOURS}.${signature}`;

    expect(await verifySessionToken(SECRET, forged, NOW + TWELVE_HOURS + 1000)).toBe(false);
  });

  it("rejects a tampered signature", async () => {
    const token = await createSessionToken(SECRET, NOW);
    expect(await verifySessionToken(SECRET, `${token}x`, NOW)).toBe(false);
  });

  it("rejects malformed and missing tokens", async () => {
    for (const bad of [undefined, "", ".", "nodot", ".onlysig", "abc.def"]) {
      expect(await verifySessionToken(SECRET, bad, NOW)).toBe(false);
    }
  });

  it("rejects a non-numeric expiry that is correctly signed", async () => {
    // A signed-but-nonsense payload must fail closed rather than NaN its way
    // through the expiry comparison.
    const token = await createSessionToken(SECRET, NOW);
    const signature = token.slice(token.lastIndexOf(".") + 1);
    expect(await verifySessionToken(SECRET, `notanumber.${signature}`, NOW)).toBe(false);
  });
});

describe("safeEqual", () => {
  it("compares equal strings", () => {
    expect(safeEqual("hunter2", "hunter2")).toBe(true);
  });

  it("rejects different strings, including different lengths", () => {
    expect(safeEqual("hunter2", "hunter3")).toBe(false);
    expect(safeEqual("hunter2", "hunter22")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
