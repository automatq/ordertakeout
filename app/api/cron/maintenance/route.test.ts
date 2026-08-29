import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serverEnv: vi.fn(),
  runMaintenance: vi.fn(),
  runFastMaintenance: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ serverEnv: mocks.serverEnv }));
vi.mock("@/lib/maintenance", () => ({
  runMaintenance: mocks.runMaintenance,
  runFastMaintenance: mocks.runFastMaintenance,
}));

import { GET } from "./route";

function request(path: string, authorization?: string): Request {
  return new Request(`https://example.com${path}`, {
    headers: authorization ? { authorization } : {},
  });
}

describe("maintenance cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serverEnv.mockReturnValue({ CRON_SECRET: "cron-secret-cron-secret" });
    mocks.runMaintenance.mockResolvedValue({ holds: 1, anonymizedOrders: 0 });
    mocks.runFastMaintenance.mockResolvedValue({ holds: 1 });
  });

  it("rejects a missing or wrong bearer token", async () => {
    const missing = await GET(request("/api/cron/maintenance"));
    const wrong = await GET(request("/api/cron/maintenance", "Bearer nope"));
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(mocks.runMaintenance).not.toHaveBeenCalled();
    expect(mocks.runFastMaintenance).not.toHaveBeenCalled();
  });

  it("fails closed when CRON_SECRET is unset", async () => {
    mocks.serverEnv.mockReturnValue({ CRON_SECRET: undefined });
    const response = await GET(request("/api/cron/maintenance", "Bearer undefined"));
    expect(response.status).toBe(401);
  });

  it("runs the fast scope when asked", async () => {
    const response = await GET(
      request("/api/cron/maintenance?scope=fast", "Bearer cron-secret-cron-secret"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, scope: "fast" });
    expect(mocks.runFastMaintenance).toHaveBeenCalledOnce();
    expect(mocks.runMaintenance).not.toHaveBeenCalled();
  });

  it("runs the full pass by default", async () => {
    const response = await GET(
      request("/api/cron/maintenance", "Bearer cron-secret-cron-secret"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, scope: "full" });
    expect(mocks.runMaintenance).toHaveBeenCalledOnce();
    expect(mocks.runFastMaintenance).not.toHaveBeenCalled();
  });
});
