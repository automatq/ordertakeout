import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: () => ({ execute }),
}));

import { consumeRateLimit } from "./rate-limit";

describe("consumeRateLimit", () => {
  it("binds the rolling-window cutoff as a Postgres-safe string", async () => {
    // Regression: ISSUE-001 — inventory checks crashed when postgres-js received a Date parameter.
    // Found by /qa on 2026-08-19
    // Report: .gstack/qa-reports/qa-report-localhost-2026-08-19.md
    execute.mockImplementationOnce(async (query) => {
      const compiled = new PgDialect().sqlToQuery(query);
      const cutoffParameters = compiled.params.slice(2);

      expect(compiled.sql).toContain("::timestamptz");
      expect(cutoffParameters).toHaveLength(2);
      expect(cutoffParameters.every((parameter) => typeof parameter === "string")).toBe(true);
      expect(cutoffParameters[0]).toBe(cutoffParameters[1]);
      expect(Number.isNaN(Date.parse(String(cutoffParameters[0])))).toBe(false);

      return [{ attempts: 1, window_started_at: new Date() }];
    });

    await expect(
      consumeRateLimit("inventory", "visitor|store", { attempts: 30, windowMs: 60_000 }),
    ).resolves.toMatchObject({ allowed: true });
  });
});
