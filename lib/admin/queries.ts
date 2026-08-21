import "server-only";

import { and, asc, desc, eq, gte, isNotNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { blackoutDates, notificationLog, orders, productsConfig, slotCapacity, webhookEvents } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { normalizeTime, storeToday, type StoreDate, type StoreTime } from "@/lib/scheduling/time";

/** Reads and writes behind the admin screens. */

export async function listOperationalIssues() {
  const staleRefundCutoff = new Date(Date.now() - 30 * 60_000);
  const [refunds, squareSync, notifications, webhooks] = await Promise.all([
    db()
      .select({
        orderNumber: orders.orderNumber,
        status: orders.refundStatus,
        error: orders.refundError,
      })
      .from(orders)
      .where(or(
        eq(orders.refundStatus, "failed"),
        and(eq(orders.refundStatus, "pending"), lt(orders.updatedAt, staleRefundCutoff)),
      ))
      .orderBy(desc(orders.updatedAt))
      .limit(10),
    db()
      .select({ orderNumber: orders.orderNumber, error: orders.squareSyncError })
      .from(orders)
      .where(isNotNull(orders.squareSyncError))
      .orderBy(desc(orders.updatedAt))
      .limit(10),
    db()
      .select({ orderId: notificationLog.orderId, channel: notificationLog.channel, event: notificationLog.event, error: notificationLog.lastError, attempts: notificationLog.attempts })
      .from(notificationLog)
      .where(eq(notificationLog.status, "failed"))
      .orderBy(desc(notificationLog.createdAt))
      .limit(10),
    db()
      .select({ eventType: webhookEvents.eventType, error: webhookEvents.error, receivedAt: webhookEvents.receivedAt })
      .from(webhookEvents)
      .where(isNotNull(webhookEvents.error))
      .orderBy(desc(webhookEvents.receivedAt))
      .limit(10),
  ]);
  return { refunds, squareSync, notifications, webhooks };
}

export interface ProductRuleRow {
  productId: string;
  slug: string;
  leadTimeDays: number;
  orderCutoffTime: StoreTime;
  allowedPickupTimes: StoreTime[];
  maxUnitsPerDay: number | null;
  isOrderable: boolean;
  sortOrder: number;
  descriptionMd: string | null;
  heroImageUrl: string | null;
}

export async function listProductRules(): Promise<ProductRuleRow[]> {
  const rows = await db()
    .select()
    .from(productsConfig)
    .orderBy(asc(productsConfig.sortOrder), asc(productsConfig.slug));

  return rows.map((row) => ({
    productId: row.squareCatalogObjectId,
    slug: row.slug,
    leadTimeDays: row.leadTimeDays,
    orderCutoffTime: normalizeTime(row.orderCutoffTime),
    allowedPickupTimes: row.allowedPickupTimes.map(normalizeTime),
    maxUnitsPerDay: row.maxUnitsPerDay,
    isOrderable: row.isOrderable,
    sortOrder: row.sortOrder,
    descriptionMd: row.descriptionMd,
    heroImageUrl: row.heroImageUrl,
  }));
}

/**
 * Create or update a product's ordering rules.
 *
 * An upsert because the same form serves both cases: configuring a product that
 * Square has but we've never seen, and editing one that already exists.
 */
export async function saveProductRules(input: {
  productId: string;
  slug: string;
  leadTimeDays: number;
  orderCutoffTime: StoreTime;
  allowedPickupTimes: StoreTime[];
  maxUnitsPerDay: number | null;
  isOrderable: boolean;
  descriptionMd: string | null;
  heroImageUrl: string | null;
}): Promise<void> {
  const values = {
    squareCatalogObjectId: input.productId,
    slug: input.slug,
    leadTimeDays: input.leadTimeDays,
    orderCutoffTime: input.orderCutoffTime,
    allowedPickupTimes: input.allowedPickupTimes,
    maxUnitsPerDay: input.maxUnitsPerDay,
    isOrderable: input.isOrderable,
    descriptionMd: input.descriptionMd,
    heroImageUrl: input.heroImageUrl,
    updatedAt: new Date(),
  };

  await db()
    .insert(productsConfig)
    .values(values)
    .onConflictDoUpdate({
      target: productsConfig.squareCatalogObjectId,
      set: values,
    });
}

export async function listBlackoutDates(): Promise<{ locationId: string | null; date: StoreDate; reason: string | null }[]> {
  // Only from today forward: past closures are history, and a growing list of
  // them would bury the ones that still matter.
  const today = storeToday(new Date(), serverEnv().STORE_TIMEZONE);
  const rows = await db()
    .select()
    .from(blackoutDates)
    .where(gte(blackoutDates.date, today))
    .orderBy(asc(blackoutDates.date));

  return rows.map((row) => ({ locationId: row.squareLocationId, date: row.date, reason: row.reason }));
}

export async function addBlackoutDate(locationId: string, date: StoreDate, reason: string | null): Promise<void> {
  await db()
    .insert(blackoutDates)
    .values({ squareLocationId: locationId, date, reason })
    .onConflictDoUpdate({
      target: [blackoutDates.squareLocationId, blackoutDates.date],
      set: { reason },
    });
}

export async function removeBlackoutDate(locationId: string, date: StoreDate): Promise<void> {
  await db()
    .delete(blackoutDates)
    .where(and(eq(blackoutDates.squareLocationId, locationId), eq(blackoutDates.date, date)));
}

export async function listSlotCapacity(): Promise<
  { locationId: string | null; pickupDate: StoreDate; pickupTime: StoreTime; maxOrders: number }[]
> {
  const today = storeToday(new Date(), serverEnv().STORE_TIMEZONE);
  const rows = await db()
    .select()
    .from(slotCapacity)
    .where(gte(slotCapacity.pickupDate, today))
    .orderBy(asc(slotCapacity.pickupDate), asc(slotCapacity.pickupTime));

  return rows.map((row) => ({
    locationId: row.squareLocationId,
    pickupDate: row.pickupDate,
    pickupTime: normalizeTime(row.pickupTime),
    maxOrders: row.maxOrders,
  }));
}

export async function setSlotCapacity(
  locationId: string,
  pickupDate: StoreDate,
  pickupTime: StoreTime,
  maxOrders: number,
): Promise<void> {
  await db()
    .insert(slotCapacity)
    .values({ squareLocationId: locationId, pickupDate, pickupTime: normalizeTime(pickupTime), maxOrders })
    .onConflictDoUpdate({
      target: [slotCapacity.squareLocationId, slotCapacity.pickupDate, slotCapacity.pickupTime],
      set: { maxOrders },
    });
}

export async function clearSlotCapacity(
  locationId: string,
  pickupDate: StoreDate,
  pickupTime: StoreTime,
): Promise<void> {
  await db()
    .delete(slotCapacity)
    .where(
      sql`${slotCapacity.squareLocationId} = ${locationId} AND ${slotCapacity.pickupDate} = ${pickupDate} AND ${slotCapacity.pickupTime} = ${normalizeTime(pickupTime)}`,
    );
}
