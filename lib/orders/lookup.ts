import "server-only";

import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { orderItems, orders, type Order, type OrderItem } from "@/lib/db/schema";

import { isOrderNumber, normalizeOrderNumber } from "./number";

export interface OrderWithItems extends Order {
  items: OrderItem[];
}

/**
 * Look an order up by its reference.
 *
 * Order numbers are random rather than sequential precisely so this lookup can
 * exist without letting anyone walk the order table. Note it still exposes an
 * order to whoever holds the number — fine for a confirmation link, but if the
 * store ever wants a general "find my order" page, pair it with the email
 * address before showing anything.
 */
export async function getOrderByNumber(reference: string): Promise<OrderWithItems | null> {
  const orderNumber = normalizeOrderNumber(reference);
  if (!isOrderNumber(orderNumber)) return null;

  const [order] = await db()
    .select()
    .from(orders)
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);

  if (!order) return null;

  const items = await db()
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.nameSnapshot));

  return { ...order, items };
}
