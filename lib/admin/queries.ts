import "server-only";

import { asc, eq, gte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { blackoutDates, productsConfig, slotCapacity } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { normalizeTime, storeToday, type StoreDate, type StoreTime } from "@/lib/scheduling/time";

/** Reads and writes behind the admin screens. */

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

export async function listBlackoutDates(): Promise<{ date: StoreDate; reason: string | null }[]> {
  // Only from today forward: past closures are history, and a growing list of
  // them would bury the ones that still matter.
  const today = storeToday(new Date(), serverEnv().STORE_TIMEZONE);
  const rows = await db()
    .select()
    .from(blackoutDates)
    .where(gte(blackoutDates.date, today))
    .orderBy(asc(blackoutDates.date));

  return rows.map((row) => ({ date: row.date, reason: row.reason }));
}

export async function addBlackoutDate(date: StoreDate, reason: string | null): Promise<void> {
  await db()
    .insert(blackoutDates)
    .values({ date, reason })
    .onConflictDoUpdate({ target: blackoutDates.date, set: { reason } });
}

export async function removeBlackoutDate(date: StoreDate): Promise<void> {
  await db().delete(blackoutDates).where(eq(blackoutDates.date, date));
}

export async function listSlotCapacity(): Promise<
  { pickupDate: StoreDate; pickupTime: StoreTime; maxOrders: number }[]
> {
  const today = storeToday(new Date(), serverEnv().STORE_TIMEZONE);
  const rows = await db()
    .select()
    .from(slotCapacity)
    .where(gte(slotCapacity.pickupDate, today))
    .orderBy(asc(slotCapacity.pickupDate), asc(slotCapacity.pickupTime));

  return rows.map((row) => ({
    pickupDate: row.pickupDate,
    pickupTime: normalizeTime(row.pickupTime),
    maxOrders: row.maxOrders,
  }));
}

export async function setSlotCapacity(
  pickupDate: StoreDate,
  pickupTime: StoreTime,
  maxOrders: number,
): Promise<void> {
  await db()
    .insert(slotCapacity)
    .values({ pickupDate, pickupTime: normalizeTime(pickupTime), maxOrders })
    .onConflictDoUpdate({
      target: [slotCapacity.pickupDate, slotCapacity.pickupTime],
      set: { maxOrders },
    });
}

export async function clearSlotCapacity(
  pickupDate: StoreDate,
  pickupTime: StoreTime,
): Promise<void> {
  await db()
    .delete(slotCapacity)
    .where(
      sql`${slotCapacity.pickupDate} = ${pickupDate} AND ${slotCapacity.pickupTime} = ${normalizeTime(pickupTime)}`,
    );
}
