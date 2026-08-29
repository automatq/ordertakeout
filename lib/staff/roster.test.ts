import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  serverEnv: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/env", () => ({ serverEnv: mocks.serverEnv }));

import { normalizeInitials, saveStaffMember, validateInitials, verifyStaffPin } from "./roster";

function selectRows(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => Object.assign(Promise.resolve(rows), { limit })),
    })),
  };
}

describe("staff roster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serverEnv.mockReturnValue({
      ORDER_ACCESS_SECRET: "a".repeat(32),
      STAFF_DASHBOARD_PASSWORD: "shared-password",
    });
  });

  it("normalizes initials and rejects malformed values", () => {
    expect(normalizeInitials("  mg ")).toBe("MG");
    expect(normalizeInitials("mga")).toBe("MGA");
    expect(normalizeInitials("m")).toBeNull();
    expect(normalizeInitials("1234")).toBeNull();
    expect(normalizeInitials("toolonginitials")).toBeNull();
  });

  it("accepts any well-formed initials while the active roster is empty", async () => {
    mocks.db.mockReturnValue({ select: vi.fn(() => selectRows([])) });
    await expect(validateInitials("zz")).resolves.toEqual({ ok: true, memberId: null });
  });

  it("validates against the active roster once one exists", async () => {
    mocks.db.mockReturnValue({
      select: vi.fn(() => selectRows([{ id: "m1", initials: "MG" }])),
    });
    await expect(validateInitials("mg")).resolves.toEqual({ ok: true, memberId: "m1" });
    await expect(validateInitials("zz")).resolves.toMatchObject({ ok: false });
  });

  it("rejects a malformed PIN before touching the database", async () => {
    const insert = vi.fn();
    mocks.db.mockReturnValue({ insert });
    await expect(
      saveStaffMember({ name: "Maria", initials: "mg", pin: "12" }),
    ).resolves.toMatchObject({ ok: false, message: expect.stringContaining("4 digits") });
    expect(insert).not.toHaveBeenCalled();
  });

  it("maps a unique violation to a friendly duplicate-initials message", async () => {
    const values = vi.fn(() => ({
      returning: vi.fn().mockRejectedValue(Object.assign(new Error("dup"), { code: "23505" })),
    }));
    mocks.db.mockReturnValue({ insert: vi.fn(() => ({ values })) });
    await expect(saveStaffMember({ name: "Maria", initials: "MG" })).resolves.toEqual({
      ok: false,
      message: "The initials MG are already taken.",
    });
  });

  it("verifies a PIN only for an existing member with one set", async () => {
    mocks.db.mockReturnValue({ select: vi.fn(() => selectRows([{ pinHash: null }])) });
    await expect(verifyStaffPin("MG", "1234")).resolves.toBe(false);
    await expect(verifyStaffPin("MG", "12a4")).resolves.toBe(false);
  });
});
