import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettingFresh: vi.fn(),
  listSettingsByPrefixFresh: vi.fn(),
  setSetting: vi.fn(),
}));

vi.mock("./store", () => ({
  getSettingFresh: mocks.getSettingFresh,
  listSettingsByPrefixFresh: mocks.listSettingsByPrefixFresh,
  setSetting: mocks.setSetting,
  SETTINGS_TAG: "settings",
}));

import {
  FALLBACK_SLOT_CAPACITY,
  getSlotCapacityDefault,
  listSlotCapacityDefaults,
  setSlotCapacityDefault,
  slotCapacityDefaultSchema,
} from "./capacity";

/** Stub the store as a plain key → value map. */
function stored(values: Record<string, number>) {
  mocks.getSettingFresh.mockImplementation(async (key: string) =>
    key in values ? { maxOrdersPerSlot: values[key] } : null,
  );
}

beforeEach(() => {
  mocks.getSettingFresh.mockReset();
  mocks.listSettingsByPrefixFresh.mockReset();
  mocks.setSetting.mockReset();
  stored({});
});

describe("getSlotCapacityDefault", () => {
  it("falls back to the compiled-in default when nothing is configured", async () => {
    await expect(getSlotCapacityDefault("LOC-1")).resolves.toBe(FALLBACK_SLOT_CAPACITY);
    await expect(getSlotCapacityDefault(null)).resolves.toBe(FALLBACK_SLOT_CAPACITY);
  });

  it("uses the global setting for a location with none of its own", async () => {
    stored({ "capacity.slot-default.global": 40 });
    await expect(getSlotCapacityDefault("LOC-1")).resolves.toBe(40);
  });

  it("prefers the location's own setting over the global one", async () => {
    stored({ "capacity.slot-default.global": 40, "capacity.slot-default.LOC-1": 12 });
    await expect(getSlotCapacityDefault("LOC-1")).resolves.toBe(12);
    // The busy branch's override must not leak onto its quieter sibling.
    await expect(getSlotCapacityDefault("LOC-2")).resolves.toBe(40);
  });

  it("ignores a location override when asked for the global value", async () => {
    stored({ "capacity.slot-default.LOC-1": 12 });
    await expect(getSlotCapacityDefault(null)).resolves.toBe(FALLBACK_SLOT_CAPACITY);
    await expect(getSlotCapacityDefault(undefined)).resolves.toBe(FALLBACK_SLOT_CAPACITY);
  });

  it("does not read the per-location key when no location is given", async () => {
    await getSlotCapacityDefault(null);
    expect(mocks.getSettingFresh).toHaveBeenCalledTimes(1);
    expect(mocks.getSettingFresh).toHaveBeenCalledWith(
      "capacity.slot-default.global",
      slotCapacityDefaultSchema,
    );
  });

  /* Availability is an enforcement read: a cached capacity would keep selling a
     slot the bakery just closed down. Same rule as the pause setting. The mock
     above deliberately omits getSettingCached, so reaching for it throws. */
  it("reads fresh rather than cached", async () => {
    await getSlotCapacityDefault("LOC-1");
    expect(mocks.getSettingFresh).toHaveBeenCalledWith(
      "capacity.slot-default.LOC-1",
      slotCapacityDefaultSchema,
    );
  });
});

describe("setSlotCapacityDefault", () => {
  it("writes the global key for a null location", async () => {
    await setSlotCapacityDefault(null, 40);
    expect(mocks.setSetting).toHaveBeenCalledWith(
      "capacity.slot-default.global",
      slotCapacityDefaultSchema,
      { maxOrdersPerSlot: 40 },
    );
  });

  it("scopes the key to the location id", async () => {
    await setSlotCapacityDefault("LOC-1", 12);
    expect(mocks.setSetting).toHaveBeenCalledWith(
      "capacity.slot-default.LOC-1",
      slotCapacityDefaultSchema,
      { maxOrdersPerSlot: 12 },
    );
  });
});

describe("listSlotCapacityDefaults", () => {
  it("maps the global key back to a null location", async () => {
    mocks.listSettingsByPrefixFresh.mockResolvedValue(
      new Map([
        ["capacity.slot-default.global", { maxOrdersPerSlot: 40 }],
        ["capacity.slot-default.LOC-1", { maxOrdersPerSlot: 12 }],
      ]),
    );
    await expect(listSlotCapacityDefaults()).resolves.toEqual([
      { locationId: null, maxOrdersPerSlot: 40 },
      { locationId: "LOC-1", maxOrdersPerSlot: 12 },
    ]);
  });

  it("is empty before anything is configured", async () => {
    mocks.listSettingsByPrefixFresh.mockResolvedValue(new Map());
    await expect(listSlotCapacityDefaults()).resolves.toEqual([]);
  });
});

describe("slotCapacityDefaultSchema", () => {
  it("rejects values that would close every slot or read as a typo", () => {
    // Zero would silently take the whole shop offline; the form says "at least one".
    expect(slotCapacityDefaultSchema.safeParse({ maxOrdersPerSlot: 0 }).success).toBe(false);
    expect(slotCapacityDefaultSchema.safeParse({ maxOrdersPerSlot: -1 }).success).toBe(false);
    expect(slotCapacityDefaultSchema.safeParse({ maxOrdersPerSlot: 2.5 }).success).toBe(false);
    expect(slotCapacityDefaultSchema.safeParse({ maxOrdersPerSlot: 501 }).success).toBe(false);
    expect(slotCapacityDefaultSchema.safeParse({ maxOrdersPerSlot: 1 }).success).toBe(true);
    expect(slotCapacityDefaultSchema.safeParse({ maxOrdersPerSlot: 500 }).success).toBe(true);
  });
});
