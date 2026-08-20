import { describe, expect, it } from "vitest";

import { orderProgressStepState } from "./progress";

describe("orderProgressStepState", () => {
  it("marks the picked-up milestone complete instead of in progress", () => {
    // Regression: ISSUE-004 — completed orders read “Picked up — in progress”.
    // Found by /qa on 2026-08-19
    // Report: .gstack/qa-reports/qa-report-localhost-2026-08-19.md
    expect(orderProgressStepState("completed", 3)).toEqual({
      isDone: true,
      isCurrent: false,
    });
  });

  it("keeps an active non-terminal milestone current", () => {
    expect(orderProgressStepState("ready", 2)).toEqual({
      isDone: false,
      isCurrent: true,
    });
  });
});
