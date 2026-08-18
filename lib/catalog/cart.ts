import type { CartLine } from "@/lib/scheduling/availability";

import { findVariant } from "./map";
import type { CatalogProduct, CatalogVariant } from "./types";

/**
 * The cart, and its translation into what the scheduling engine expects.
 *
 * A customer's cart references VARIANTS ("2× 25 pcs Ube") because that's what
 * has a price. The scheduling engine works in PRODUCT LINES because that's what
 * ordering rules and production capacity belong to — the bakery has one oven, so
 * "40 Ensaymada trays a day" is one budget shared across every tray size, not a
 * separate allowance per size.
 *
 * Everything here is pure so the aggregation is testable without a database.
 */

export interface CartItem {
  variantId: string;
  quantity: number;
}

export interface ResolvedCartLine {
  product: CatalogProduct;
  variant: CatalogVariant;
  quantity: number;
  lineTotalCents: number;
}

export type CartResolution =
  | { ok: true; lines: ResolvedCartLine[]; subtotalCents: number; currency: string }
  | { ok: false; unknownVariantIds: string[] };

/**
 * Resolve cart items against the catalog, pricing them from Square rather than
 * from anything the client sent. Prices must never come off the request body —
 * that's the whole point of resolving here.
 */
export function resolveCart(
  cart: readonly CartItem[],
  products: readonly CatalogProduct[],
): CartResolution {
  const lines: ResolvedCartLine[] = [];
  const unknownVariantIds: string[] = [];

  for (const item of cart) {
    const found = findVariant(products, item.variantId);
    if (!found) {
      unknownVariantIds.push(item.variantId);
      continue;
    }
    lines.push({
      product: found.product,
      variant: found.variant,
      quantity: item.quantity,
      lineTotalCents: found.variant.priceCents * item.quantity,
    });
  }

  if (unknownVariantIds.length > 0) {
    return { ok: false, unknownVariantIds };
  }

  return {
    ok: true,
    lines,
    subtotalCents: lines.reduce((sum, l) => sum + l.lineTotalCents, 0),
    currency: lines[0]?.variant.currency ?? "USD",
  };
}

/**
 * Collapse resolved cart lines into per-product-line quantities for the
 * scheduling engine. Two different Ensaymada trays become one Ensaymada line, so
 * they draw down a single daily production budget.
 */
export function toSchedulingCart(lines: readonly ResolvedCartLine[]): CartLine[] {
  const totals = new Map<string, number>();
  for (const line of lines) {
    totals.set(line.product.id, (totals.get(line.product.id) ?? 0) + line.quantity);
  }
  return [...totals].map(([productId, quantity]) => ({ productId, quantity }));
}

/** Merge duplicate entries so adding the same variant twice increments it. */
export function normalizeCart(cart: readonly CartItem[]): CartItem[] {
  const totals = new Map<string, number>();
  for (const item of cart) {
    totals.set(item.variantId, (totals.get(item.variantId) ?? 0) + item.quantity);
  }
  return [...totals]
    .filter(([, quantity]) => quantity > 0)
    .map(([variantId, quantity]) => ({ variantId, quantity }));
}
