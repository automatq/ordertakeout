import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrderableProducts: vi.fn(),
  getStoreLocationsSafe: vi.fn(),
  fetchTrackedVariationIds: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("./server", () => ({ getOrderableProducts: mocks.getOrderableProducts }));
vi.mock("@/lib/locations/server", () => ({ getStoreLocationsSafe: mocks.getStoreLocationsSafe }));
vi.mock("@/lib/inventory/server", () => ({
  fetchTrackedVariationIds: mocks.fetchTrackedVariationIds,
}));
vi.mock("@/lib/monitoring/report", () => ({ reportError: mocks.reportError }));

import { getCatalogReadiness } from "./readiness";

const PANDESAL = {
  id: "P1",
  name: "Pandesal",
  variants: [{ id: "V1", name: "6 pack" }, { id: "V2", name: "12 pack" }],
};
const UBE_CAKE = { id: "P2", name: "Ube Cake", variants: [{ id: "V3", name: "Whole" }] };

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getOrderableProducts.mockResolvedValue({ products: [PANDESAL, UBE_CAKE], skipped: [] });
  mocks.getStoreLocationsSafe.mockResolvedValue([{ id: "L1", name: "Wilson" }]);
  mocks.fetchTrackedVariationIds.mockResolvedValue(new Set(["V1", "V2", "V3"]));
});

describe("getCatalogReadiness", () => {
  it("reports nothing when every product is sellable and tracked", async () => {
    const result = await getCatalogReadiness();
    expect(result.skipped).toEqual([]);
    expect(result.locations[0]!.untracked).toEqual([]);
  });

  it("hides Square objects that are legitimately not products", async () => {
    // Categories and modifiers always get skipped; surfacing them would bury
    // the real problems in permanent noise.
    mocks.getOrderableProducts.mockResolvedValue({
      products: [],
      skipped: [
        { id: "C1", name: "Breads", reason: "not_an_item" },
        { id: "P9", name: "Mystery Loaf", reason: "variation_not_fixed_price" },
      ],
    });

    const result = await getCatalogReadiness();
    expect(result.skipped).toEqual([
      { id: "P9", name: "Mystery Loaf", reason: "variation_not_fixed_price" },
    ]);
  });

  it("flags a product with no tracked variant as never appearing", async () => {
    mocks.fetchTrackedVariationIds.mockResolvedValue(new Set(["V3"]));

    const result = await getCatalogReadiness();
    expect(result.locations[0]!.untracked).toEqual([
      {
        productId: "P1",
        name: "Pandesal",
        variantNames: ["6 pack", "12 pack"],
        wholeProduct: true,
      },
    ]);
  });

  it("distinguishes a partly-tracked product from a missing one", async () => {
    mocks.fetchTrackedVariationIds.mockResolvedValue(new Set(["V1", "V3"]));

    const [entry] = (await getCatalogReadiness()).locations[0]!.untracked;
    expect(entry).toMatchObject({ name: "Pandesal", variantNames: ["12 pack"], wholeProduct: false });
  });

  it("checks every location independently", async () => {
    mocks.getStoreLocationsSafe.mockResolvedValue([
      { id: "L1", name: "Wilson" },
      { id: "L2", name: "London" },
    ]);
    mocks.fetchTrackedVariationIds.mockImplementation(async (locationId: string) =>
      locationId === "L1" ? new Set(["V1", "V2", "V3"]) : new Set<string>(),
    );

    const result = await getCatalogReadiness();
    expect(result.locations[0]!.untracked).toEqual([]);
    expect(result.locations[1]!.untracked).toHaveLength(2);
  });

  it("omits a branch whose check failed rather than reporting it healthy", async () => {
    // A thrown location must read as "not checked", never as "all good".
    mocks.getStoreLocationsSafe.mockResolvedValue([
      { id: "L1", name: "Wilson" },
      { id: "L2", name: "London" },
    ]);
    mocks.fetchTrackedVariationIds.mockImplementation(async (locationId: string) => {
      if (locationId === "L2") throw new Error("square down");
      return new Set(["V1", "V2", "V3"]);
    });

    const result = await getCatalogReadiness();
    expect(result.locations.map((l) => l.locationId)).toEqual(["L1"]);
    expect(mocks.reportError).toHaveBeenCalledOnce();
  });

  it("says so plainly when the catalog itself could not be read", async () => {
    mocks.getOrderableProducts.mockResolvedValue({
      products: [],
      skipped: [],
      error: "Square unreachable",
    });

    const result = await getCatalogReadiness();
    expect(result.error).toBe("Square unreachable");
    expect(result.locations).toEqual([]);
    expect(mocks.fetchTrackedVariationIds).not.toHaveBeenCalled();
  });
});
