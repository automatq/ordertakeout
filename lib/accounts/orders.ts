import "server-only";

import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { orderItems, orders } from "@/lib/db/schema";

/**
 * The orders belonging to one account.
 *
 * The account page on the website runs the equivalent queries inline, tangled
 * up with loyalty points and passkeys. This is not that view — it is the list a
 * phone needs — so the two are separate on purpose rather than by accident. What
 * they must agree on is one line, `customer_account_id = $1`, and if that ever
 * grows a second condition it belongs here and the page should adopt it.
 */
export interface AccountOrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  pickupDate: string;
  pickupTime: string;
  totalCents: number;
  currency: string;
  pickupLocationName: string | null;
  items: { name: string; quantity: number }[];
}

export async function listAccountOrders(
  accountId: string,
  limit = 20,
): Promise<AccountOrderSummary[]> {
  const rows = await db()
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      pickupDate: orders.pickupDate,
      pickupTime: orders.pickupTime,
      totalCents: orders.totalCents,
      currency: orders.currency,
      pickupLocationName: orders.pickupLocationName,
    })
    .from(orders)
    .where(eq(orders.customerAccountId, accountId))
    .orderBy(desc(orders.createdAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const lines = await db()
    .select({
      orderId: orderItems.orderId,
      name: orderItems.nameSnapshot,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .where(inArray(orderItems.orderId, rows.map((row) => row.id)));

  const byOrder = new Map<string, { name: string; quantity: number }[]>();
  for (const line of lines) {
    const list = byOrder.get(line.orderId) ?? [];
    list.push({ name: line.name, quantity: line.quantity });
    byOrder.set(line.orderId, list);
  }

  return rows.map((row) => ({ ...row, items: byOrder.get(row.id) ?? [] }));
}
