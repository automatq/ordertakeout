import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import type { CatalogObject } from "square";

import { db } from "@/lib/db";
import { productsConfig } from "@/lib/db/schema";
import { normalizeTime } from "@/lib/scheduling/time";
import { DEMO_PRODUCTS, DEMO_PRODUCT_RULES } from "@/lib/demo/catalog";
import { isDemoMode } from "@/lib/demo/config";
import { matchProductConfig } from "@/lib/demo/product-config";
import { serverEnv } from "@/lib/env";
import { reportError } from "@/lib/monitoring/report";
import { squareClient } from "@/lib/square/client";

import { parseAllergens, parseDietaryTags, type Allergen, type DietaryTag } from "./dietary";
import { attachCategoryNames, collectCategoryIds } from "./categories";
import { attachImageUrls, collectImageIds, extractImageUrls } from "./images";
import { mapCatalogItems } from "./map";
import type { CatalogProduct, SkippedCatalogObject, StoreProduct } from "./types";

/**
 * Reading the catalog: Square for items and prices, our database for the
 * ordering rules Square has no concept of.
 *
 * Square is the source of truth for what's sold and what it costs, so the store
 * keeps editing prices in the Square Dashboard exactly as they do today and the
 * website follows. Nothing about the menu is hardcoded here.
 */

export const CATALOG_TAG = "square-catalog";
export const PRODUCT_CONFIG_TAG = "product-config";

export interface CatalogLoad {
  products: CatalogProduct[];
  skipped: SkippedCatalogObject[];
  /**
   * Set when Square could not be reached. The storefront renders an explicit
   * "temporarily unavailable" state for this rather than an empty menu — an
   * empty shop looks like the bakery sells nothing, which is worse than saying
   * so plainly.
   */
  error?: string;
}

/**
 * Fetch every catalog item from Square, following pagination.
 *
 * Cached for hours because item names and prices change rarely, and a page view
 * should not cost a Square API call. Staff can force a refresh from the admin
 * screen, which invalidates CATALOG_TAG.
 */
async function fetchSquareCatalog(): Promise<CatalogLoad> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG);

  // Demo mode: same shape mapCatalogItems would return, so every downstream
  // path behaves identically to the Square-backed one.
  if (isDemoMode()) {
    return { products: DEMO_PRODUCTS, skipped: [] };
  }

  try {
    const client = squareClient();
    const objects: CatalogObject[] = [];
    let cursor: string | undefined;

    do {
      const response = await client.catalog.searchItems({ limit: 100, cursor });
      objects.push(...(response.items ?? []));
      cursor = response.cursor;
    } while (cursor);

    const mapped = mapCatalogItems(objects, { expectedCurrency: serverEnv().STORE_CURRENCY });
    const withImages = attachImageUrls(mapped.products, await fetchImageUrls(client, mapped));

    return {
      ...mapped,
      products: attachCategoryNames(withImages, await fetchCategoryNames(client, withImages)),
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    reportError("catalog", "Square catalog fetch failed", cause);
    return { products: [], skipped: [], error: message };
  }
}

/**
 * Resolve the IMAGE objects the items reference.
 *
 * `searchItems` returns image *ids* only, so without this pass every product
 * renders its typographic fallback tile. Deliberately non-fatal: a menu with no
 * photos is a degraded storefront, but a menu that fails to load because the
 * image call timed out is a closed one. Errors are logged and swallowed.
 *
 * Square caps `batchGet` at 1000 ids per call; this bakery has three products,
 * so the chunking is insurance rather than a live concern.
 */
async function fetchImageUrls(
  client: ReturnType<typeof squareClient>,
  mapped: { products: CatalogProduct[] },
): Promise<Map<string, string>> {
  const ids = collectImageIds(mapped.products);
  if (ids.length === 0) return new Map();

  try {
    const urls = new Map<string, string>();

    for (let start = 0; start < ids.length; start += 1000) {
      const response = await client.catalog.batchGet({
        objectIds: ids.slice(start, start + 1000),
      });
      for (const [id, url] of extractImageUrls(response.objects ?? [])) {
        urls.set(id, url);
      }
    }

    return urls;
  } catch (cause) {
    reportError("catalog", "image resolution failed, falling back to text tiles", cause);
    return new Map();
  }
}

/**
 * Resolve the CATEGORY objects the items reference.
 *
 * `searchItems` returns category *ids* on each item, never names, so this is a
 * second lookup with the same shape as image resolution — and non-fatal for the
 * same reason. A menu that renders ungrouped is a degraded storefront; a menu
 * that fails to load because a category lookup timed out is a closed one.
 */
async function fetchCategoryNames(
  client: ReturnType<typeof squareClient>,
  products: readonly CatalogProduct[],
): Promise<Map<string, string>> {
  const ids = collectCategoryIds(products);
  if (ids.length === 0) return new Map();

  try {
    const names = new Map<string, string>();

    for (let start = 0; start < ids.length; start += 1000) {
      const response = await client.catalog.batchGet({
        objectIds: ids.slice(start, start + 1000),
      });
      for (const object of response.objects ?? []) {
        const name = object.type === "CATEGORY" ? object.categoryData?.name?.trim() : null;
        if (object.id && name) names.set(object.id, name);
      }
    }

    return names;
  } catch (cause) {
    reportError("catalog", "category resolution failed, menu will be ungrouped", cause);
    return new Map();
  }
}

interface ProductConfigRow {
  productId: string;
  slug: string;
  leadTimeDays: number;
  orderCutoffTime: string;
  allowedPickupTimes: string[];
  maxUnitsPerDay: number | null;
  isOrderable: boolean;
  sortOrder: number;
  heroImageUrl: string | null;
  descriptionMd: string | null;
  allergens: Allergen[];
  dietaryTags: DietaryTag[];
}

/**
 * Ordering rules and presentation overrides, keyed by Square ITEM id.
 *
 * Failure is caught for the same reason as the Square fetch: if the database is
 * unreachable we cannot know any product's cutoff, so the honest outcome is an
 * explicit "unavailable" storefront, not a menu rendered without its rules.
 */
async function fetchProductConfig(): Promise<{ rows: ProductConfigRow[]; error?: string }> {
  "use cache";
  cacheLife("hours");
  cacheTag(PRODUCT_CONFIG_TAG);

  try {
    const rows = await db().select().from(productsConfig);
    return {
      rows: rows.map((row) => ({
        productId: row.squareCatalogObjectId,
        slug: row.slug,
        leadTimeDays: row.leadTimeDays,
        orderCutoffTime: normalizeTime(row.orderCutoffTime),
        allowedPickupTimes: row.allowedPickupTimes.map(normalizeTime),
        maxUnitsPerDay: row.maxUnitsPerDay,
        isOrderable: row.isOrderable,
        sortOrder: row.sortOrder,
        heroImageUrl: row.heroImageUrl,
        descriptionMd: row.descriptionMd,
        allergens: parseAllergens(row.allergens),
        dietaryTags: parseDietaryTags(row.dietaryTags),
      })),
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    reportError("catalog", "product config fetch failed", cause);
    return { rows: [], error: message };
  }
}

export interface StoreCatalog {
  products: StoreProduct[];
  /** In Square, but with no ordering rules configured — see below. */
  unconfigured: CatalogProduct[];
  skipped: SkippedCatalogObject[];
  error?: string;
}

/**
 * The storefront menu: Square catalog joined to ordering rules.
 *
 * A product with no `products_config` row is deliberately NOT sellable. Without
 * a configured lead time and cutoff we don't know when it could be collected, and
 * guessing would mean promising a pickup the kitchen never agreed to. Those items
 * are returned separately so the admin screen can prompt staff to configure them
 * instead of them vanishing without explanation.
 */
export async function getStoreCatalog(): Promise<StoreCatalog> {
  const [catalog, config] = await Promise.all([fetchSquareCatalog(), fetchProductConfig()]);

  const configById = new Map(config.rows.map((c) => [c.productId, c]));
  const demoMode = isDemoMode();
  const products: StoreProduct[] = [];
  const unconfigured: CatalogProduct[] = [];

  for (const product of catalog.products) {
    const rules = configById.get(product.id) ?? matchProductConfig(
      product.id,
      config.rows,
      DEMO_PRODUCT_RULES,
      demoMode,
    );
    if (!rules) {
      unconfigured.push(product);
      continue;
    }

    products.push({
      ...product,
      /* Demo fixtures retain fake variation IDs while borrowing the configured
         Square item ID. This keeps order history/cancellation joins intact. */
      id: rules.productId,
      slug: rules.slug,
      heroImageUrl: rules.heroImageUrl,
      descriptionMd: rules.descriptionMd,
      sortOrder: rules.sortOrder,
      allergens: rules.allergens,
      dietaryTags: rules.dietaryTags,
      rule: {
        productId: rules.productId,
        leadTimeDays: rules.leadTimeDays,
        orderCutoffTime: rules.orderCutoffTime,
        allowedPickupTimes: rules.allowedPickupTimes,
        maxUnitsPerDay: rules.maxUnitsPerDay,
        isOrderable: rules.isOrderable,
      },
    });
  }

  products.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  return {
    products,
    unconfigured,
    skipped: catalog.skipped,
    error: catalog.error ?? config.error,
  };
}

/** Products a customer can actually order right now. */
export async function getOrderableProducts(): Promise<StoreCatalog> {
  const catalog = await getStoreCatalog();
  return { ...catalog, products: catalog.products.filter((p) => p.rule.isOrderable) };
}

export async function getProductBySlug(slug: string): Promise<StoreProduct | null> {
  const { products } = await getOrderableProducts();
  return products.find((p) => p.slug === slug) ?? null;
}
