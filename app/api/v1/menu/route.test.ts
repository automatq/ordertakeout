import { beforeEach, describe, expect, it, vi } from "vitest";

import { absoluteImageUrl, menuResponseSchema } from "@/lib/api/dto";
import { VARIANT_AVAILABILITY_LIMIT } from "@/lib/inventory/map";

const mocks = vi.hoisted(() => ({
  getOrderableProducts: vi.fn(),
  getInStockVariationIds: vi.fn(async (_locationId: string, ids: readonly string[]) => new Set(ids)),
  getStoreLocation: vi.fn(async (id: string) => (id.startsWith("LOC") ? { id } : null)),
}));

vi.mock("@/lib/catalog/server", () => ({ getOrderableProducts: mocks.getOrderableProducts }));
vi.mock("@/lib/inventory/server", () => ({ getInStockVariationIds: mocks.getInStockVariationIds }));
vi.mock("@/lib/locations/server", () => ({ getStoreLocation: mocks.getStoreLocation }));

const { GET } = await import("./route");

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: "ITEM-1",
    slug: "ensaymada-tray",
    name: "Ensaymada Party Tray",
    description: "From Square",
    descriptionMd: "Buttery, cheesy, ours.",
    imageUrls: ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
    heroImageUrl: null,
    categoryId: "CAT-1",
    categoryName: "Party Trays",
    sortOrder: 1,
    allergens: ["milk", "eggs"],
    dietaryTags: [],
    rule: {
      leadTimeDays: 2,
      orderCutoffTime: "18:00",
      // Operational: how the shop is run, not what a customer picks a cake with.
      maxUnitsPerDay: 12,
      isOrderable: true,
      allowedPickupTimes: ["16:00"],
    },
    variants: [
      { id: "VAR-1", name: "25 pcs", priceCents: 2500, currency: "CAD", sku: null, ordinal: 0 },
    ],
    ...overrides,
  };
}

const menu = (query = "") => GET(new Request(`http://localhost/api/v1/menu${query}`));

beforeEach(() => {
  mocks.getOrderableProducts.mockReset();
  mocks.getOrderableProducts.mockResolvedValue({ products: [product()], unconfigured: [], error: null });
  mocks.getInStockVariationIds.mockClear();
});

describe("GET /api/v1/menu", () => {
  it("is public, like the storefront it mirrors", async () => {
    // A menu is the one thing a bakery wants read by as many people as possible.
    expect((await menu()).status).toBe(200);
  });

  it("parses under the strict schema and leaks no operational rules", async () => {
    const { data } = await (await menu()).json();
    expect(() => menuResponseSchema.parse(data)).not.toThrow();

    const raw = JSON.stringify(data);
    for (const leaked of ["maxUnitsPerDay", "isOrderable", "allowedPickupTimes", "sortOrder"]) {
      expect(raw).not.toContain(leaked);
    }
  });

  it("reports availability as unknown when no location is given", async () => {
    /* Null is not false and it is certainly not true. Telling somebody a
       sold-out cake is available and taking their money is the failure this
       exists to prevent. */
    const { data } = await (await menu()).json();
    expect(data.locationId).toBeNull();
    expect(data.groups[0].products[0].variants[0].available).toBeNull();
    expect(mocks.getInStockVariationIds).not.toHaveBeenCalled();
  });

  it("resolves real availability once a location is chosen", async () => {
    mocks.getInStockVariationIds.mockResolvedValueOnce(new Set<string>());
    const { data } = await (await menu("?locationId=LOC-1")).json();
    expect(data.locationId).toBe("LOC-1");
    expect(data.groups[0].products[0].variants[0].available).toBe(false);
  });

  it("treats an unknown location as no location rather than an error", async () => {
    // The menu is still worth showing; the app will ask for a location anyway.
    const response = await menu("?locationId=GONE");
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.locationId).toBeNull();
    expect(data.groups[0].products[0].variants[0].available).toBeNull();
  });

  it("asks about every variant, in batches, when the catalog is large", async () => {
    /* Regression in shape: Square caps how many variations one inventory call
       may cover. Truncating silently would mark the tail of a big menu sold
       out — and a big menu is exactly when it would happen. */
    const many = Array.from({ length: VARIANT_AVAILABILITY_LIMIT + 25 }, (_, i) => ({
      id: `VAR-${i}`,
      name: `${i}`,
      priceCents: 100,
      currency: "CAD",
      sku: null,
      ordinal: i,
    }));
    mocks.getOrderableProducts.mockResolvedValue({
      products: [product({ variants: many })],
      unconfigured: [],
      error: null,
    });

    const { data } = await (await menu("?locationId=LOC-1")).json();

    expect(mocks.getInStockVariationIds).toHaveBeenCalledTimes(2);
    const asked = mocks.getInStockVariationIds.mock.calls.flatMap(([, ids]) => [...ids]);
    expect(asked).toHaveLength(many.length);
    expect(data.groups[0].products[0].variants.every((v: { available: unknown }) => v.available === true)).toBe(true);
  });

  it("prefers the shop's own description and hero image over Square's", async () => {
    const { data } = await (await menu()).json();
    const item = data.groups[0].products[0];
    expect(item.description).toBe("Buttery, cheesy, ours.");
    expect(item.imageUrl).toBe("https://cdn.example/a.jpg");
  });

  it("makes a local image path absolute", async () => {
    /* A path is only meaningful to a client on the same origin. A native app is
       not one, and `<Image src="/harina/ube-bars.webp">` renders nothing —
       found by building the app and getting a menu of grey rectangles. */
    mocks.getOrderableProducts.mockResolvedValue({
      products: [product({ heroImageUrl: "/harina/ube-bars.webp" })],
      unconfigured: [],
      error: null,
    });
    const { data } = await (await menu()).json();
    expect(data.groups[0].products[0].imageUrl).toBe("http://localhost/harina/ube-bars.webp");
  });
});

describe("absoluteImageUrl", () => {
  it("leaves an absolute URL alone", () => {
    // Square's CDN is already absolute; rewriting it would break the image.
    for (const url of ["https://cdn.example/a.jpg", "http://cdn.example/a.jpg"]) {
      expect(absoluteImageUrl(url, "https://harina.example")).toBe(url);
    }
  });

  it("joins a path to the base without doubling or dropping the slash", () => {
    expect(absoluteImageUrl("/a.jpg", "https://harina.example")).toBe("https://harina.example/a.jpg");
    expect(absoluteImageUrl("/a.jpg", "https://harina.example/")).toBe("https://harina.example/a.jpg");
    expect(absoluteImageUrl("a.jpg", "https://harina.example")).toBe("https://harina.example/a.jpg");
  });

  it("passes null through", () => {
    expect(absoluteImageUrl(null, "https://harina.example")).toBeNull();
  });

  it("says so plainly when Square is down", async () => {
    mocks.getOrderableProducts.mockResolvedValue({ products: [], unconfigured: [], error: "boom" });
    const response = await menu();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "unavailable" },
    });
  });
});
