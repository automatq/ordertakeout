import { describe, expect, it } from "vitest";

import { resolvePause, type PauseSetting } from "./pause";

function setting(overrides: Partial<PauseSetting> = {}): PauseSetting {
  return {
    paused: true,
    note: null,
    resumeAt: null,
    setBy: null,
    setAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("pause resolution", () => {
  it("is open when nothing is set", () => {
    expect(resolvePause(null, null)).toBeNull();
  });

  it("global pause wins over the location's state", () => {
    expect(resolvePause(setting({ note: "oven down" }), null)).toEqual({
      scope: "global",
      note: "oven down",
      resumeAt: null,
    });
  });

  it("falls back to the location pause", () => {
    expect(resolvePause(null, setting())).toMatchObject({ scope: "location" });
  });

  it("auto-resumes at read time once resumeAt passes", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(resolvePause(setting({ resumeAt: past }), null)).toBeNull();
    expect(resolvePause(setting({ resumeAt: future }), null)).toMatchObject({
      scope: "global",
      resumeAt: future,
    });
  });

  it("treats an unset paused flag as open", () => {
    expect(resolvePause(setting({ paused: false }), setting({ paused: false }))).toBeNull();
  });
});
