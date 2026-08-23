import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/monitoring/report", () => ({ reportError: mocks.reportError }));

import { getSettingFresh, setSetting } from "./store";

const SCHEMA = z.object({ paused: z.boolean(), note: z.string().nullable() });

function selectReturning(rows: unknown[]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue(rows) })),
      })),
    })),
  };
}

describe("settings store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a parsed value when the stored jsonb matches the schema", async () => {
    mocks.db.mockReturnValue(selectReturning([{ value: { paused: true, note: "oven down" } }]));
    await expect(getSettingFresh("ordering.pause.global", SCHEMA)).resolves.toEqual({
      paused: true,
      note: "oven down",
    });
  });

  it("treats a missing row as unset", async () => {
    mocks.db.mockReturnValue(selectReturning([]));
    await expect(getSettingFresh("ordering.pause.global", SCHEMA)).resolves.toBeNull();
    expect(mocks.reportError).not.toHaveBeenCalled();
  });

  it("treats a schema-invalid stored value as unset and reports it", async () => {
    mocks.db.mockReturnValue(selectReturning([{ value: { paused: "yes" } }]));
    await expect(getSettingFresh("ordering.pause.global", SCHEMA)).resolves.toBeNull();
    expect(mocks.reportError).toHaveBeenCalledWith(
      "settings",
      expect.stringContaining("failed validation"),
      undefined,
      expect.objectContaining({ key: "ordering.pause.global" }),
    );
  });

  it("refuses to write a value that fails its own schema", async () => {
    const insert = vi.fn();
    mocks.db.mockReturnValue({ insert });
    await expect(
      setSetting("ordering.pause.global", SCHEMA, { paused: "nope" } as never),
    ).rejects.toThrow();
    expect(insert).not.toHaveBeenCalled();
  });

  it("upserts a valid value", async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    mocks.db.mockReturnValue({ insert: vi.fn(() => ({ values })) });

    await setSetting("ordering.pause.global", SCHEMA, { paused: false, note: null });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ key: "ordering.pause.global", value: { paused: false, note: null } }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalled();
  });
});
