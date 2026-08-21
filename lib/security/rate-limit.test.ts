import { describe, expect, it } from "vitest";

import { rateLimitFingerprint } from "./rate-limit";

describe("rateLimitFingerprint", () => {
  it("uses Vercel's forwarding header ahead of proxy fallbacks", () => {
    expect(rateLimitFingerprint({
      vercelForwardedFor: "203.0.113.10",
      forwardedFor: "198.51.100.9",
      realIp: "192.0.2.8",
    })).toBe("203.0.113.10");
  });

  it("takes the public client from a forwarding chain", () => {
    expect(rateLimitFingerprint({
      forwardedFor: "203.0.113.10, 10.0.0.2",
    })).toBe("203.0.113.10");
  });
  it("falls back without incorporating caller-controlled headers", () => {
    expect(rateLimitFingerprint({ realIp: "203.0.113.10" })).toBe("203.0.113.10");
    expect(rateLimitFingerprint({})).toBe("unknown");
  });
});
