import type { CatalogProduct } from "./types";

/**
 * Category names, resolved and attached separately from the item fetch.
 *
 * Square's `searchItems` returns category *ids* on each item, not names, so a
 * second lookup is needed — the same shape as image resolution, and pure here
 * for the same reason: this module never talks to Square.
 */

/** Category ids worth looking up, de-duplicated. */
export function collectCategoryIds(products: readonly CatalogProduct[]): string[] {
  return [...new Set(products.flatMap((product) => (product.categoryId ? [product.categoryId] : [])))];
}

export function attachCategoryNames<T extends CatalogProduct>(
  products: readonly T[],
  names: ReadonlyMap<string, string>,
): T[] {
  return products.map((product) => ({
    ...product,
    categoryName: product.categoryId ? names.get(product.categoryId) ?? null : null,
  }));
}

/** Where uncategorised products are filed, and the label they get. */
export const UNCATEGORISED = "More";

export interface ProductGroup<T> {
  /** Null for the uncategorised bucket. */
  categoryId: string | null;
  name: string;
  products: T[];
}

/**
 * Group products into menu sections.
 *
 * Section order follows the lowest menu position within each section, so the
 * existing per-product "Menu position" field is the single control for both
 * within-section and between-section ordering rather than introducing a second,
 * conflicting one. Ties fall back to the category name, and uncategorised
 * products always come last regardless of their positions — a section called
 * "More" leading the menu reads like a bug.
 */
export function groupByCategory<T extends CatalogProduct & { sortOrder?: number }>(
  products: readonly T[],
): ProductGroup<T>[] {
  const groups = new Map<string, ProductGroup<T>>();

  for (const product of products) {
    const key = product.categoryId ?? "";
    const name = product.categoryId ? product.categoryName ?? UNCATEGORISED : UNCATEGORISED;
    const existing = groups.get(key);
    if (existing) existing.products.push(product);
    else groups.set(key, { categoryId: product.categoryId, name, products: [product] });
  }

  const rank = (group: ProductGroup<T>) =>
    Math.min(...group.products.map((product) => product.sortOrder ?? 0));

  return [...groups.values()].sort((a, b) => {
    const aLast = a.name === UNCATEGORISED && a.categoryId === null;
    const bLast = b.name === UNCATEGORISED && b.categoryId === null;
    if (aLast !== bLast) return aLast ? 1 : -1;
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });
}
