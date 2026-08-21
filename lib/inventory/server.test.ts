import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cachedRaw: vi.fn(),
  freshRaw: vi.fn(),
  subtractHolds: vi.fn(),
}));

vi.mock("./raw", () => ({
  INVENTORY_TAG: "square-inventory",
  getCachedRawInventoryQuantities: mocks.cachedRaw,
  getFreshRawInventoryQuantities: mocks.freshRaw,
}));

vi.mock("./reservations", () => ({
  subtractActiveInventoryHolds: mocks.subtractHolds,
}));

import {
  getFreshInventoryQuantities,
  getInventoryQuantities,
} from "./server";

describe("location inventory facade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cachedRaw.mockResolvedValue(new Map([["VAR", 1]]));
    mocks.freshRaw.mockResolvedValue(new Map([["VAR", 1]]));
  });

  it("subtracts live holds outside the cached raw Square loader on every read", async () => {
    mocks.subtractHolds
      .mockResolvedValueOnce(new Map([["VAR", 1]]))
      .mockResolvedValueOnce(new Map([["VAR", 0]]));

    expect(await getInventoryQuantities("LOC", ["VAR"]))
      .toEqual(new Map([["VAR", 1]]));
    expect(await getInventoryQuantities("LOC", ["VAR"]))
      .toEqual(new Map([["VAR", 0]]));

    expect(mocks.subtractHolds).toHaveBeenCalledTimes(2);
    expect(mocks.cachedRaw).toHaveBeenCalledTimes(2);
  });

  it("excludes only the current order from a fresh pre-charge read", async () => {
    mocks.subtractHolds.mockResolvedValue(new Map([["VAR", 1]]));

    await getFreshInventoryQuantities(
      "LOC",
      ["VAR"],
      { excludeOrderId: "31c490a7-93a6-46e9-9f01-a51ad95a46c4" },
    );

    expect(mocks.freshRaw).toHaveBeenCalledWith("LOC", ["VAR"]);
    expect(mocks.subtractHolds).toHaveBeenCalledWith(
      "LOC",
      new Map([["VAR", 1]]),
      { excludeOrderId: "31c490a7-93a6-46e9-9f01-a51ad95a46c4" },
    );
  });
});
