import type { MenuProduct, MenuVariant } from "./api";

/**
 * The order being built, before it becomes an order.
 *
 * Lines reference the product and variant by id rather than embedding them, so
 * a refreshed menu — a new price, a size withdrawn — is reflected the next time
 * the cart is resolved instead of being frozen at the moment something was
 * tapped. A customer who added a tray yesterday should not be quoted yesterday's
 * price today.
 */

export interface CartLine {
  productId: string;
  variantId: string;
  quantity: number;
}

export interface ResolvedLine extends CartLine {
  product: MenuProduct;
  variant: MenuVariant;
  totalCents: number;
}

export interface CartTotals {
  lines: ResolvedLine[];
  /** Lines whose product or size is no longer on the menu. */
  droppedCount: number;
  itemCount: number;
  subtotalCents: number;
  currency: string;
}

const EMPTY: CartTotals = {
  lines: [],
  droppedCount: 0,
  itemCount: 0,
  subtotalCents: 0,
  currency: "CAD",
};

/**
 * Attach current menu data to each line, dropping anything that has gone.
 *
 * Silently dropping is deliberate but must be visible: `droppedCount` is
 * reported so the cart can say "we removed a tray that sold out" rather than a
 * total quietly changing by itself.
 */
export function resolveCart(cart: readonly CartLine[], menu: readonly MenuProduct[]): CartTotals {
  if (cart.length === 0) return EMPTY;

  const byId = new Map(menu.map((product) => [product.id, product]));
  const lines: ResolvedLine[] = [];
  let dropped = 0;

  for (const line of cart) {
    const product = byId.get(line.productId);
    const variant = product?.variants.find((v) => v.id === line.variantId);
    if (!product || !variant) {
      dropped += 1;
      continue;
    }
    lines.push({
      ...line,
      product,
      variant,
      totalCents: variant.priceCents * line.quantity,
    });
  }

  return {
    lines,
    droppedCount: dropped,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
    /* From the cart's own contents, not a constant: a shop trading in more than
       one currency would otherwise render the wrong symbol on the total. */
    currency: lines[0]?.variant.currency ?? EMPTY.currency,
  };
}

/**
 * Add to the cart, merging with a line for the same size.
 *
 * Tapping "add" twice should read as two trays on one line, not two lines that
 * happen to be identical — the second is how somebody ends up deleting one and
 * being surprised.
 */
export function addLine(
  cart: readonly CartLine[],
  productId: string,
  variantId: string,
  quantity: number,
): CartLine[] {
  const at = cart.findIndex(
    (line) => line.productId === productId && line.variantId === variantId,
  );
  if (at === -1) return [...cart, { productId, variantId, quantity }];

  return cart.map((line, i) =>
    i === at ? { ...line, quantity: line.quantity + quantity } : line,
  );
}

/** Quantity never drops below one — removing is its own action. */
export function setQuantity(cart: readonly CartLine[], index: number, quantity: number): CartLine[] {
  return cart.map((line, i) => (i === index ? { ...line, quantity: Math.max(1, quantity) } : line));
}

export function removeLine(cart: readonly CartLine[], index: number): CartLine[] {
  return cart.filter((_, i) => i !== index);
}

/** What the availability endpoint wants. */
export const toAvailabilityCart = (lines: readonly ResolvedLine[]) =>
  lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity }));
