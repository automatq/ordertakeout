import type { CatalogObject } from "square";

import type { CatalogProduct } from "./types";

/** Token-coloured low-fi placeholder for remote Square/staff imagery. */
export const PRODUCT_BLUR_DATA_URL =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjYiPjxyZWN0IHdpZHRoPSI4IiBoZWlnaHQ9IjYiIGZpbGw9IiNlYWQ4Y2EiLz48L3N2Zz4=";

/**
 * Product photography.
 *
 * `imageIds` has always been mapped off Square's catalog items, but nothing
 * ever turned those ids into URLs — so every product card fell back to a
 * typographic tile and the product, cart, checkout and confirmation screens had
 * no imagery at all. Square returns image *references* on an item; the URLs live
 * on separate IMAGE catalog objects, which is the fetch that was missing.
 *
 * Kept separate from map.ts because that module is pure and fixture-tested,
 * while this one needs the API. The extraction below is still pure, so the
 * awkward part — Square's optional-everything wire format — stays testable.
 */

/** Pull `id → url` out of a batch of catalog objects, ignoring non-images. */
export function extractImageUrls(objects: readonly CatalogObject[]): Map<string, string> {
  const urls = new Map<string, string>();

  for (const object of objects) {
    if (object.type !== "IMAGE") continue;
    const url = object.imageData?.url;
    if (url) urls.set(object.id, url);
  }

  return urls;
}

/** Every image id referenced by a product set, de-duplicated and order-stable. */
export function collectImageIds(products: readonly CatalogProduct[]): string[] {
  const ids = new Set<string>();
  for (const product of products) {
    for (const id of product.imageIds) ids.add(id);
  }
  return [...ids];
}

/**
 * Attach resolved URLs to each product, preserving the item's own image order.
 *
 * An id with no URL is dropped rather than rendered as a broken image: Square
 * lets an item reference an image that has since been deleted, and a gap in the
 * grid reads as a bug where a missing photo just reads as a product without one.
 */
export function attachImageUrls<T extends CatalogProduct>(
  products: readonly T[],
  urls: ReadonlyMap<string, string>,
): T[] {
  return products.map((product) => ({
    ...product,
    imageUrls: product.imageIds
      .map((id) => urls.get(id))
      .filter((url): url is string => Boolean(url)),
  }));
}

/**
 * The images to show for a product, most authoritative first.
 *
 * `heroImageUrl` is the staff override from `products_config` — it wins because
 * a human chose it for this specific purpose. Square's own images follow in the
 * order the item lists them.
 */
type ProductWithImages = {
  imageUrls: readonly string[];
  heroImageUrl?: string | null;
};

export function productImages(product: ProductWithImages): string[] {
  const images = product.heroImageUrl
    ? [product.heroImageUrl, ...product.imageUrls]
    : [...product.imageUrls];

  // A hero that is also the item's first Square image would otherwise appear
  // twice in the gallery.
  return [...new Set(images)];
}

/** The single image to lead with, or null when the product has no photography. */
export function primaryImage(product: ProductWithImages): string | null {
  return productImages(product)[0] ?? null;
}

/**
 * Square resizes on request via a `w` query parameter. Asking for the width we
 * actually render saves multiple megabytes on a grid of trays, and is a no-op
 * for any other host (a staff-supplied override URL, a local /public path).
 */
export function sizedImage(url: string, width: number): string {
  if (!url.includes("squarecdn.com") && !url.includes("square-catalog")) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("w", String(width));
    return parsed.toString();
  } catch {
    return url;
  }
}
