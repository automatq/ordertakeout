import { describe, expect, it } from "vitest";

import { attachCategoryNames, collectCategoryIds, groupByCategory, UNCATEGORISED } from "./categories";
import type { CatalogProduct } from "./types";

function product(overrides: Partial<CatalogProduct & { sortOrder: number }> = {}) {
  return {
    id: "P1",
    name: "Pandesal",
    description: null,
    imageIds: [],
    imageUrls: [],
    categoryId: null,
    categoryName: null,
    variants: [],
    sortOrder: 0,
    ...overrides,
  };
}

describe("collectCategoryIds", () => {
  it("de-duplicates and skips uncategorised products", () => {
    expect(
      collectCategoryIds([
        product({ id: "A", categoryId: "C1" }),
        product({ id: "B", categoryId: "C1" }),
        product({ id: "C", categoryId: "C2" }),
        product({ id: "D", categoryId: null }),
      ]),
    ).toEqual(["C1", "C2"]);
  });
});

describe("attachCategoryNames", () => {
  it("leaves the name null when the lookup had no answer", () => {
    // Category resolution is non-fatal, so an unresolved id must degrade to an
    // ungrouped product rather than rendering an empty heading.
    const [attached] = attachCategoryNames([product({ categoryId: "C_GONE" })], new Map());
    expect(attached!.categoryName).toBeNull();
  });

  it("attaches a resolved name", () => {
    const [attached] = attachCategoryNames(
      [product({ categoryId: "C1" })],
      new Map([["C1", "Breads"]]),
    );
    expect(attached!.categoryName).toBe("Breads");
  });
});

describe("groupByCategory", () => {
  it("orders sections by their lowest menu position", () => {
    // The per-product Menu position field is the single ordering control; a
    // separate category order would be a second, conflicting one.
    const groups = groupByCategory([
      product({ id: "A", categoryId: "C_CAKE", categoryName: "Cakes", sortOrder: 5 }),
      product({ id: "B", categoryId: "C_BREAD", categoryName: "Breads", sortOrder: 1 }),
      product({ id: "C", categoryId: "C_CAKE", categoryName: "Cakes", sortOrder: 9 }),
    ]);

    expect(groups.map((group) => group.name)).toEqual(["Breads", "Cakes"]);
    expect(groups[1]!.products.map((p) => p.id)).toEqual(["A", "C"]);
  });

  it("always puts uncategorised products last, whatever their position", () => {
    // A section called "More" leading the menu reads like a bug.
    const groups = groupByCategory([
      product({ id: "A", categoryId: null, sortOrder: 0 }),
      product({ id: "B", categoryId: "C_BREAD", categoryName: "Breads", sortOrder: 7 }),
    ]);

    expect(groups.map((group) => group.name)).toEqual(["Breads", UNCATEGORISED]);
  });

  it("files a product whose category name never resolved under More", () => {
    const groups = groupByCategory([product({ categoryId: "C_GONE", categoryName: null })]);
    expect(groups[0]!.name).toBe(UNCATEGORISED);
  });

  it("breaks ties on category name so the menu is stable between syncs", () => {
    const groups = groupByCategory([
      product({ id: "A", categoryId: "C2", categoryName: "Pastries", sortOrder: 0 }),
      product({ id: "B", categoryId: "C1", categoryName: "Breads", sortOrder: 0 }),
    ]);
    expect(groups.map((group) => group.name)).toEqual(["Breads", "Pastries"]);
  });

  it("returns a single group for a one-category catalog", () => {
    const groups = groupByCategory([
      product({ id: "A", categoryId: "C1", categoryName: "Party Trays" }),
      product({ id: "B", categoryId: "C1", categoryName: "Party Trays" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.products).toHaveLength(2);
  });
});
