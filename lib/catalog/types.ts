import type { Allergen, DietaryTag } from "@/lib/catalog/dietary";
import type { ProductRule } from "@/lib/scheduling/availability";

/**
 * Domain catalog types.
 *
 * Deliberately not Square's shapes. Square's `CatalogObject` has almost every
 * field optional, nests variations inside items, and types money as `bigint` —
 * fine for an API wire format, miserable to render. Mapping once at the edge
 * (lib/catalog/map.ts) means the rest of the app works with data that is already
 * known-good.
 */

/**
 * A specific sellable thing — "25 pcs Ube". This is what a cart line references
 * and what gets written to `order_items`.
 */
export interface CatalogVariant {
  /** Square ITEM_VARIATION id. */
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  sku: string | null;
  ordinal: number;
  /** Present only when a storefront location has been selected. */
  available?: boolean;
}

/**
 * A product line — "Ensaymada Party Tray" — holding its variants.
 *
 * Ordering rules key on this rather than on variants: the bakery has one oven,
 * so a daily production cap belongs to Ensaymada as a whole, not separately to
 * the 25-piece and 56-piece trays.
 */
export interface CatalogProduct {
  /** Square ITEM id. This is what `products_config` is keyed on. */
  id: string;
  name: string;
  description: string | null;
  /** Square IMAGE object ids, in the order the item lists them. */
  imageIds: string[];
  /**
   * `imageIds` resolved to CDN URLs (lib/catalog/images.ts).
   *
   * Separate from the ids because resolving them costs a second Square call, so
   * it happens once in the cached server load rather than per render. Empty
   * where the item has no photography or a referenced image has been deleted.
   */
  imageUrls: string[];
  /**
   * Square's reporting category for this item, if it has one. Null both when
   * the item is uncategorised and when the name lookup failed — the storefront
   * treats those identically and files the product under "More".
   */
  categoryId: string | null;
  categoryName: string | null;
  variants: CatalogVariant[];
}

/** A catalog product joined to its ordering rules and presentation overrides. */
export interface StoreProduct extends CatalogProduct {
  slug: string;
  rule: ProductRule;
  heroImageUrl: string | null;
  descriptionMd: string | null;
  sortOrder: number;
  /** From lib/catalog/dietary.ts's fixed vocabulary. Empty = not stated, never "free from". */
  allergens: Allergen[];
  dietaryTags: DietaryTag[];
}

export type SkipReason =
  | "not_an_item"
  | "archived"
  | "missing_name"
  | "no_sellable_variants"
  | "variation_missing_price"
  | "variation_not_fixed_price"
  | "variation_currency_mismatch";

/**
 * A catalog object that could not be sold online, and why.
 *
 * `id` is nullable because Square's own SDK types `CatalogObjectCategory.id` as
 * optional, unlike every other catalog object — so a category genuinely may have
 * no id to report.
 */
export interface SkippedCatalogObject {
  id: string | null;
  name: string | null;
  reason: SkipReason;
}

export interface MappedCatalog {
  products: CatalogProduct[];
  /**
   * Surfaced rather than silently dropped, so the admin re-sync screen can say
   * "2 items skipped: variable pricing" instead of quietly showing a short menu.
   */
  skipped: SkippedCatalogObject[];
}
