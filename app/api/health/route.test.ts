import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  serverEnv: vi.fn(),
  publicEnv: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/env", () => ({ serverEnv: mocks.serverEnv, publicEnv: mocks.publicEnv }));

import { GET } from "./route";

describe("health endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serverEnv.mockReturnValue({});
    mocks.publicEnv.mockReturnValue({ NEXT_PUBLIC_SQUARE_ENVIRONMENT: "sandbox" });
    mocks.db.mockReturnValue({ execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]) });
  });

  it("reports up when the database answers", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      db: "up",
      environment: "sandbox",
    });
  });

  it("reports down without leaking details when the database fails", async () => {
    mocks.db.mockReturnValue({ execute: vi.fn().mockRejectedValue(new Error("ECONNREFUSED 10.0.0.5")) });
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ ok: false, db: "down" });
  });

  it("reports invalid configuration when env validation throws", async () => {
    mocks.serverEnv.mockImplementation(() => {
      throw new Error("Invalid server environment");
    });
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, config: "invalid" });
  });
});
