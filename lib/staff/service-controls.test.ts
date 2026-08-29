import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addAvailabilityOverride: vi.fn(async (_input: Record<string, unknown>) => {}),
  removeAvailabilityOverride: vi.fn(async (_id: string) => {}),
  setOrderingPause: vi.fn(
    async (
      _scope: "global" | { locationId: string },
      _value: { paused: boolean; note: string | null; resumeAt: string | null; setBy: string | null },
    ) => {},
  ),
  recordAudit: vi.fn(async (_entry: Record<string, unknown>) => {}),
  getStoreLocation: vi.fn(async (id: string) => (id.startsWith("LOC") ? { id } : null)),
  serverEnv: vi.fn(() => ({ STORE_TIMEZONE: "America/Toronto" })),
}));

vi.mock("@/lib/admin/queries", () => ({
  addAvailabilityOverride: mocks.addAvailabilityOverride,
  removeAvailabilityOverride: mocks.removeAvailabilityOverride,
}));
vi.mock("@/lib/audit/log", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/settings/pause", () => ({ setOrderingPause: mocks.setOrderingPause }));
vi.mock("@/lib/locations/server", () => ({ getStoreLocation: mocks.getStoreLocation }));
vi.mock("@/lib/env", () => ({ serverEnv: mocks.serverEnv }));
vi.mock("@/lib/catalog/server", () => ({ PRODUCT_CONFIG_TAG: "product-config" }));
vi.mock("@/lib/settings/store", () => ({ SETTINGS_TAG: "settings" }));

const { clearSoldOut, markSoldOut, pauseOrdering } = await import("./service-controls");

/* The caller supplies this because the right primitive differs between a Server
   Action and a Route Handler — see InvalidateTag. Spied here so the tests also
   check that a refused change invalidates nothing. */
const invalidate = vi.fn((_tag: string) => {});

/** Today in the store's zone, which is what markSoldOut compares against. */
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockClear();
  invalidate.mockClear();
});

describe("pauseOrdering", () => {
  it("stores the note and an auto-resume when pausing", async () => {
    const before = Date.now();
    await expect(
      pauseOrdering({ scope: "global", paused: true, note: "  oven down  ", resumeMinutes: 60 }, invalidate),
    ).resolves.toEqual({ ok: true });

    const [scope, value] = mocks.setOrderingPause.mock.calls[0]!;
    expect(scope).toBe("global");
    expect(value.paused).toBe(true);
    expect(value.note).toBe("oven down");

    const resumeAt = new Date(value.resumeAt!).getTime();
    expect(resumeAt).toBeGreaterThanOrEqual(before + 60 * 60_000);
    expect(resumeAt).toBeLessThan(before + 61 * 60_000);

    expect(invalidate).toHaveBeenCalledWith("settings");
  });

  it("clears the note and the auto-resume when resuming", async () => {
    /* A stale "back at 3pm" hanging off an open shop is worse than no note —
       the storefront would show it to customers who can already order. */
    await pauseOrdering({ scope: "global", paused: false, note: "oven down", resumeMinutes: 60 }, invalidate);
    const [, value] = mocks.setOrderingPause.mock.calls[0]!;
    expect(value).toMatchObject({ paused: false, note: null, resumeAt: null });
  });

  it("refuses a location that is no longer active, and writes nothing", async () => {
    await expect(
      pauseOrdering({ scope: { locationId: "GONE" }, paused: true }, invalidate),
    ).resolves.toEqual({ ok: false, error: "That pickup location is no longer active." });
    expect(mocks.setOrderingPause).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
    // Nothing changed, so nothing should be invalidated either.
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("records who did it, uppercased", async () => {
    await pauseOrdering({ scope: "global", paused: true, staffInitials: " ms " }, invalidate);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ordering.paused", actorInitials: "MS" }),
    );
  });

  it("distinguishes pausing from resuming in the audit trail", async () => {
    await pauseOrdering({ scope: { locationId: "LOC-1" }, paused: false }, invalidate);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ordering.resumed",
        entityType: "location",
        entityId: "LOC-1",
      }),
    );
  });
});

describe("markSoldOut", () => {
  const base = { productId: "ITEM-1", locationIds: ["LOC-1"], date: today() };

  it("writes one row per location", async () => {
    await expect(
      markSoldOut({ ...base, locationIds: ["LOC-1", "LOC-2"], reason: "  ran out  " }, invalidate),
    ).resolves.toEqual({ ok: true });

    expect(mocks.addAvailabilityOverride).toHaveBeenCalledTimes(2);
    expect(mocks.addAvailabilityOverride).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "ITEM-1", locationId: "LOC-2", reason: "ran out" }),
    );
    expect(invalidate).toHaveBeenCalledWith("product-config");
  });

  it("refuses a date in the past", async () => {
    // The row would be written and then never read, which looks like it worked.
    await expect(markSoldOut({ ...base, date: "2020-01-01" }, invalidate)).resolves.toEqual({
      ok: false,
      error: "Pick today or a future date.",
    });
    expect(mocks.addAvailabilityOverride).not.toHaveBeenCalled();
  });

  it("refuses the whole request if any location is gone", async () => {
    /* Checked before anything is written, so a bad id cannot leave half the
       branches marked sold out and half not. */
    await expect(
      markSoldOut({ ...base, locationIds: ["LOC-1", "GONE"] }, invalidate),
    ).resolves.toMatchObject({ ok: false });
    expect(mocks.addAvailabilityOverride).not.toHaveBeenCalled();
  });

  it("turns an empty reason into null rather than an empty string", async () => {
    await markSoldOut({ ...base, reason: "   " }, invalidate);
    expect(mocks.addAvailabilityOverride).toHaveBeenCalledWith(
      expect.objectContaining({ reason: null }),
    );
  });
});

describe("clearSoldOut", () => {
  it("removes the entry and records who did it", async () => {
    await expect(clearSoldOut("override-1", invalidate, "ab")).resolves.toEqual({ ok: true });
    expect(mocks.removeAvailabilityOverride).toHaveBeenCalledWith("override-1");
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "product.86_removed", actorInitials: "AB" }),
    );
  });
});
