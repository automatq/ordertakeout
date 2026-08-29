import { describe, expect, it } from "vitest";

import { compactDisplayLinePull, DISPLAY_SAFE_LINE_HEIGHT, displayLineHeight } from "./typography";

describe("display typography", () => {
  it("uses a line box that leaves room for Bebas Neue's iOS glyphs", () => {
    expect(DISPLAY_SAFE_LINE_HEIGHT).toBeGreaterThan(1);
    expect(displayLineHeight(38)).toBeGreaterThan(38);
  });

  it("keeps the former cart and hero treatments on the shared safe line box", () => {
    expect(displayLineHeight(38)).toBeCloseTo(44.08);
    expect(displayLineHeight(56)).toBeCloseTo(64.96);
    expect(compactDisplayLinePull(56, 1, 0.88)).toBeCloseTo(-15.68);
  });
});
