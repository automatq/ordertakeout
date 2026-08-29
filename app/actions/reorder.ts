"use server";

import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { currentAccountId } from "@/lib/accounts/session";
import { getOrderableProducts } from "@/lib/catalog/server";
import { db } from "@/lib/db";
import { orderItems, orders } from "@/lib/db/schema";

export type ReorderPreview = {
  ok: true;
  items: Array<{
    variantId: string;
    name: string;
    quantity: number;
    /** Still in the catalog and orderable — price and slots re-check at checkout. */
    available: boolean;
  }>;
};

export type PrepareReorderResult = ReorderPreview | { ok: false; message: string };

const inputSchema = z.object({ orderId: z.uuid() });

/**
 * Pre-check a past order against today's catalog before touching the cart.
 *
 * Menus change: a tray from March may be retired, renamed, or 86'd from
 * ordering. Blindly re-adding old variant IDs produced carts that failed at
 * checkout with no explanation. This returns per-item availability so the
 * button can say "2 of 3 are still available" and add only those.
 */
export async function prepareReorder(input: unknown): Promise<PrepareReorderResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That order can't be reordered." };

  const accountId = await currentAccountId();
  if (!accountId) return { ok: false, message: "Sign in to reorder from your history." };

  const [order] = await db()
    .select({ id: orders.id, customerAccountId: orders.customerAccountId })
    .from(orders)
    .where(eq(orders.id, parsed.data.orderId))
    .limit(1);
  if (!order || order.customerAccountId !== accountId) {
    return { ok: false, message: "That order can't be reordered." };
  }

  const [items, catalog] = await Promise.all([
    db()
      .select({
        variantId: orderItems.squareCatalogObjectId,
        name: orderItems.nameSnapshot,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id))
      .orderBy(asc(orderItems.id)),
    getOrderableProducts(),
  ]);
  if (items.length === 0) return { ok: false, message: "That order has no items to reorder." };

  const orderableVariantIds = new Set(
    catalog.products.flatMap((product) => product.variants.map((variant) => variant.id)),
  );

  return {
    ok: true,
    items: items.map((item) => ({
      ...item,
      available: orderableVariantIds.has(item.variantId),
    })),
  };
}
