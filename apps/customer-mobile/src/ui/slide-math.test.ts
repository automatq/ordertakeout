import { describe, expect, it } from "vitest";

import {
  COMMIT_FRACTION,
  nextArmed,
  shouldCommit,
  slideFraction,
  travelFor,
} from "./slide-math";

describe("slide-to-pay travel", () => {
  it("measures the room the thumb has between the insets", () => {
    expect(travelFor(360, 4, 48)).toBe(304);
  });

  it("never goes negative on a screen too narrow to hold the thumb", () => {
    expect(travelFor(40, 4, 48)).toBe(0);
  });

  it("reads as nought progress before layout, not NaN", () => {
    expect(slideFraction(120, 0)).toBe(0);
  });

  it("clamps at both ends", () => {
    expect(slideFraction(-40, 200)).toBe(0);
    expect(slideFraction(400, 200)).toBe(1);
    expect(slideFraction(100, 200)).toBe(0.5);
  });
});

describe("committing", () => {
  it("wants a slow drag to nearly finish", () => {
    expect(shouldCommit(0.8, 0)).toBe(false);
    expect(shouldCommit(0.83, 0)).toBe(true);
    expect(shouldCommit(COMMIT_FRACTION, 0)).toBe(true);
  });

  it("takes a fling from past halfway", () => {
    expect(shouldCommit(0.55, 1.2)).toBe(true);
  });

  it("does not take the same fling from the first third", () => {
    expect(shouldCommit(0.35, 1.2)).toBe(false);
  });

  it("never pays on a leftward throw", () => {
    expect(shouldCommit(0.6, -2)).toBe(false);
  });
});

describe("arming hysteresis", () => {
  it("arms past the threshold", () => {
    expect(nextArmed(0.9, false)).toBe(true);
  });

  it("keeps an armed slider armed inside the band, without arming a fresh one", () => {
    expect(nextArmed(0.75, true)).toBe(true);
    expect(nextArmed(0.75, false)).toBe(false);
  });

  it("disarms below the band", () => {
    expect(nextArmed(0.4, true)).toBe(false);
  });
});
