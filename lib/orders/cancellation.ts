import "server-only";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { orderItems, productsConfig, type Order } from "@/lib/db/schema";
import { addCalendarDays, normalizeTime, pickupInstant } from "@/lib/scheduling/time";
import { serverEnv } from "@/lib/env";

export type CancellationEligibility =
  | { allowed: true; deadline: Date }
  | { allowed: false; reason: string; deadline?: Date };

/** Customer cancellation closes at the earliest product production cutoff. */
export async function customerCancellationEligibility(order: Order): Promise<CancellationEligibility> {
  if (order.status !== "paid" && order.status !== "preparing") {
    return { allowed: false, reason: "This order can no longer be cancelled online." };
  }

  const items = await db()
    .select({ productId: orderItems.squareProductId })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));
  const productIds = [...new Set(items.flatMap((item) => item.productId ? [item.productId] : []))];
  if (!items.length || productIds.length !== new Set(items.map((item) => item.productId)).size) {
    return { allowed: false, reason: "Please call the store to cancel this legacy order." };
  }

  const rules = await db()
    .select({
      productId: productsConfig.squareCatalogObjectId,
      leadTimeDays: productsConfig.leadTimeDays,
      cutoff: productsConfig.orderCutoffTime,
    })
    .from(productsConfig)
    .where(inArray(productsConfig.squareCatalogObjectId, productIds));
  if (rules.length !== productIds.length) {
    return { allowed: false, reason: "Please call the store to cancel this order." };
  }

  const timeZone = order.pickupLocationTimezone ?? serverEnv().STORE_TIMEZONE;
  const deadlines = rules.map((rule) => pickupInstant(
    addCalendarDays(order.pickupDate, -rule.leadTimeDays),
    normalizeTime(rule.cutoff),
    timeZone,
  ));
  const deadline = new Date(Math.min(...deadlines.map((date) => date.getTime())));
  return Date.now() < deadline.getTime()
    ? { allowed: true, deadline }
    : { allowed: false, reason: "The online cancellation cutoff has passed. Please call the store.", deadline };
}

