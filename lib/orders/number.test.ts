import { describe, expect, it } from "vitest";

import {
  generateOrderNumber,
  isOrderNumber,
  LEGACY_ORDER_NUMBER_CODE_LENGTH,
  normalizeOrderNumber,
  ORDER_NUMBER_CODE_LENGTH,
  ORDER_NUMBER_CODE_SPACE,
} from "./number";

describe("generateOrderNumber", () => {
  it("produces the documented format", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateOrderNumber()).toMatch(/^PT-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    }
  });

  it("never emits characters that get misread aloud", () => {
    // 0/O and 1/I/L are the pairs staff and customers confuse over a counter.
    const codes = Array.from({ length: 500 }, () => generateOrderNumber()).join("");
    expect(codes).not.toMatch(/[01OIL]/);
  });

  it("has a collision-resistant code space", () => {
    expect(ORDER_NUMBER_CODE_LENGTH).toBe(8);
    expect(ORDER_NUMBER_CODE_SPACE).toBeGreaterThan(850_000_000_000n);
  });

  it("distributes across the alphabet rather than favouring early characters", () => {
    // Guards the rejection sampling: folding 256 random bytes into a 31-character
    // alphabet with `%` would make the first four characters ~29% more likely.
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      for (const char of generateOrderNumber().slice(3)) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }

    expect(counts.size).toBe(31);
    const frequencies = [...counts.values()];
    const expected = (4000 * ORDER_NUMBER_CODE_LENGTH) / 31;
    // Generous band — this catches systematic bias, not sampling noise.
    expect(Math.min(...frequencies)).toBeGreaterThan(expected * 0.75);
    expect(Math.max(...frequencies)).toBeLessThan(expected * 1.25);
  });
});

describe("normalizeOrderNumber", () => {
  it("accepts what a customer actually types", () => {
    for (const input of ["PT-K7M2QX", "pt-k7m2qx", "K7M2QX", "  PT-K7M2QX  ", "PTK7M2QX"]) {
      expect(normalizeOrderNumber(input)).toBe("PT-K7M2QX");
    }
  });
});

describe("isOrderNumber", () => {
  it("accepts well-formed references", () => {
    expect(isOrderNumber("PT-K7M2QX")).toBe(true);
    expect(isOrderNumber("PT-K7M2QX9D")).toBe(true);
    expect(isOrderNumber("  pt-k7m2qx  ")).toBe(true);
  });

  it("rejects malformed ones rather than querying for them", () => {
    for (const bad of [
      "PT-K7M2Q",
      "PT-K7M2QXX",
      "PT-K7M2QX9",
      "K7M2QX",
      "PT-K7M2Q0",
      "PT-K7M2QI",
      "",
    ]) {
      expect(isOrderNumber(bad)).toBe(false);
    }
  });

  it("continues accepting legacy six-character references", () => {
    expect(LEGACY_ORDER_NUMBER_CODE_LENGTH).toBe(6);
    expect(isOrderNumber("PT-K7M2QX")).toBe(true);
  });
});
