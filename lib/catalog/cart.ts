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

interface CartResolutionBase {
  /** Lines that still resolve, even when another cart item was archived. */
  lines: ResolvedCartLine[];
  subtotalCents: number;
  currency: string;
}

export type CartResolution =
  | (CartResolutionBase & { ok: true })
  | (CartResolutionBase & { ok: false; unknownVariantIds: string[] });

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

  const priced = {
    lines,
    subtotalCents: lines.reduce((sum, l) => sum + l.lineTotalCents, 0),
    currency: lines[0]?.variant.currency ?? "USD",
  };

  if (unknownVariantIds.length > 0) {
    return { ok: false, unknownVariantIds, ...priced };
  }

  return { ok: true, ...priced };
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

/**
 * Apply the server's inventory reconciliation after a pickup-location switch.
 * The browser receives only the ids that remain orderable; quantities are kept
 * from the existing cart and normalized once so no unavailable line survives.
 */
export function retainCartVariants(
  cart: readonly CartItem[],
  retainedVariantIds: readonly string[],
): CartItem[] {
  const retained = new Set(retainedVariantIds);
  return normalizeCart(cart.filter((item) => retained.has(item.variantId)));
}

/**
 * Compare two cart snapshots by normalized variation quantities.
 *
 * Location reconciliation crosses a network boundary. A second tab can change
 * the cart while that request is in flight, so its response may only be applied
 * when the cart still matches the exact snapshot the server checked.
 */
export function cartSnapshotsMatch(
  left: readonly CartItem[],
  right: readonly CartItem[],
): boolean {
  const normalized = (items: readonly CartItem[]) => [...normalizeCart(items)]
    .sort((a, b) => a.variantId.localeCompare(b.variantId));
  const first = normalized(left);
  const second = normalized(right);
  return first.length === second.length && first.every((item, index) => (
    item.variantId === second[index]?.variantId
      && item.quantity === second[index]?.quantity
  ));
}

/** Remove only the quantities paid for, preserving cart edits from other tabs. */
export function subtractCartItems(
  current: readonly CartItem[],
  purchased: readonly CartItem[],
): CartItem[] {
  const purchasedQuantities = new Map(
    normalizeCart(purchased).map((item) => [item.variantId, item.quantity]),
  );
  return normalizeCart(current).flatMap((item) => {
    const quantity = item.quantity - (purchasedQuantities.get(item.variantId) ?? 0);
    return quantity > 0 ? [{ ...item, quantity }] : [];
  });
}
