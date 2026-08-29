import { describe, expect, it } from "vitest";

import { attempt } from "./nonfatal";

describe("attempt", () => {
  it("keeps a rejected native operation out of the unhandled-rejection path", async () => {
    const reports: string[] = [];
    const result = await attempt(
      "saving order",
      async () => {
        throw new Error("keychain unavailable");
      },
      (context, cause) => reports.push(`${context}: ${(cause as Error).message}`),
    );

    expect(result).toEqual({ ok: false });
    expect(reports).toEqual(["saving order: keychain unavailable"]);
  });

  it("preserves successful results", async () => {
    await expect(attempt("loading order", async () => "PT-123")).resolves.toEqual({
      ok: true,
      value: "PT-123",
    });
  });
});
