import { describe, expect, it } from "vitest";

import vercelConfig from "@/vercel.json";

describe("Vercel deployment configuration", () => {
  it("keeps maintenance on a Hobby-compatible daily schedule", () => {
    expect(vercelConfig.crons).toEqual([
      {
        path: "/api/cron/maintenance",
        schedule: "17 8 * * *",
      },
    ]);
  });
});
