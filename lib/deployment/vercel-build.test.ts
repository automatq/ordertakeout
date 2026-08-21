import { describe, expect, it } from "vitest";

import { assertProductionProject, shouldRunProductionDatabaseSteps } from "../../scripts/vercel-build";

describe("Vercel production migration guard", () => {
  it("does not mutate databases for local or preview builds", () => {
    expect(shouldRunProductionDatabaseSteps({})).toBe(false);
    expect(shouldRunProductionDatabaseSteps({ VERCEL_ENV: "preview" })).toBe(false);
  });

  it("requires the linked production project and its database URL", () => {
    expect(() => assertProductionProject({
      VERCEL_PROJECT_ID: "wrong-project",
      DATABASE_URL: "postgres://example",
    })).toThrow("unexpected Vercel project");
    expect(() => assertProductionProject({
      VERCEL_PROJECT_ID: "prj_siaBRUXE30cdFEsDC3N6Qjbj8SMn",
    })).toThrow("DATABASE_URL is required");
  });
});
