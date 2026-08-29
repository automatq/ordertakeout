import "server-only";

import { and, asc, desc, eq, gte, isNotNull, lt, or, sql } from "drizzle-orm";

import { parseAllergens, parseDietaryTags, type Allergen, type DietaryTag } from "@/lib/catalog/dietary";
import { db } from "@/lib/db";
import { blackoutDates, notificationLog, orders, productAvailabilityOverrides, productsConfig, slotCapacity, webhookEvents } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { normalizeTime, storeToday, type StoreDate, type StoreTime } from "@/lib/scheduling/time";
import { uniqueSlug } from "./validate";

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
  allergens: Allergen[];
  dietaryTags: DietaryTag[];
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
    allergens: parseAllergens(row.allergens),
    dietaryTags: parseDietaryTags(row.dietaryTags),
  }));
}

export interface BulkRuleTemplate {
  leadTimeDays: number;
  orderCutoffTime: StoreTime;
  allowedPickupTimes: StoreTime[];
  maxUnitsPerDay: number | null;
  isOrderable: boolean;
  allergens: Allergen[];
  dietaryTags: DietaryTag[];
}

export interface BulkRuleResult {
  configured: number;
  updated: number;
  /** Slugs minted for products that had no row, for the confirmation message. */
  newSlugs: { name: string; slug: string }[];
}

/**
 * Apply one set of ordering rules to many products at once.
 *
 * Onboarding a full bakery menu one form at a time is roughly forty clicks per
 * product, and the defaults are shaped for party trays — so the fast path also
 * produced the wrong answer for everyday bread. Nearly every item shares a
 * single rule; the exceptions are few enough to edit afterwards.
 *
 * Two invariants:
 *  - A product that already has a row keeps its slug, description and photo.
 *    Changing a cutoff must never silently rewrite a URL customers have, or
 *    discard copy somebody wrote.
 *  - Slugs are resolved against the whole table plus the rest of the batch, so
 *    two products whose names reduce to the same slug both succeed.
 */
export async function applyProductRulesBulk(
  products: readonly { productId: string; name: string }[],
  template: BulkRuleTemplate,
): Promise<BulkRuleResult> {
  if (products.length === 0) return { configured: 0, updated: 0, newSlugs: [] };

  return db().transaction(async (tx) => {
    const existing = await tx
      .select({ productId: productsConfig.squareCatalogObjectId, slug: productsConfig.slug })
      .from(productsConfig);

    const slugByProduct = new Map(existing.map((row) => [row.productId, row.slug]));
    const taken = new Set(existing.map((row) => row.slug));

    const newSlugs: { name: string; slug: string }[] = [];
    let configured = 0;
    let updated = 0;

    for (const product of products) {
      const current = slugByProduct.get(product.productId);
      let slug: string;
      if (current) {
        slug = current;
        updated += 1;
      } else {
        slug = uniqueSlug(product.name, taken);
        taken.add(slug);
        newSlugs.push({ name: product.name, slug });
        configured += 1;
      }

      const shared = {
        leadTimeDays: template.leadTimeDays,
        orderCutoffTime: template.orderCutoffTime,
        allowedPickupTimes: template.allowedPickupTimes,
        maxUnitsPerDay: template.maxUnitsPerDay,
        isOrderable: template.isOrderable,
        allergens: template.allergens,
        dietaryTags: template.dietaryTags,
        updatedAt: new Date(),
      };

      await tx
        .insert(productsConfig)
        .values({ squareCatalogObjectId: product.productId, slug, ...shared })
        /* Only the shared fields on conflict: slug, descriptionMd and
           heroImageUrl are intentionally absent so an existing row keeps them. */
        .onConflictDoUpdate({ target: productsConfig.squareCatalogObjectId, set: shared });
    }

    return { configured, updated, newSlugs };
  });
}

/**
 * Create or update a product's ordering rules.
 *
 * An upsert because the same form serves both cases: configuring a product that
 * Square has but we've never seen, and editing one that already exists.
 */
/** The unique index behind `products_config.slug`. */
const PRODUCT_SLUG_UNIQUE_CONSTRAINT = "products_config_slug_key";

/**
 * Whether a failed save was two products claiming one URL name.
 *
 * The pre-check in the action catches the ordinary case and can name the
 * offender; this covers the gap between that read and the write, where the
 * database is the only real arbiter.
 */
export function isSlugConflict(cause: unknown): boolean {
  const error = cause as { code?: unknown; constraint?: unknown };
  return error?.code === "23505" && error?.constraint === PRODUCT_SLUG_UNIQUE_CONSTRAINT;
}

/** Which product currently owns a URL name, if any. */
export async function productIdForSlug(slug: string): Promise<string | null> {
  const [row] = await db()
    .select({ productId: productsConfig.squareCatalogObjectId })
    .from(productsConfig)
    .where(eq(productsConfig.slug, slug))
    .limit(1);
  return row?.productId ?? null;
}

export async function saveProductRules(input: {
  productId: string;
  slug: string;
  sortOrder: number;
  leadTimeDays: number;
  orderCutoffTime: StoreTime;
  allowedPickupTimes: StoreTime[];
  maxUnitsPerDay: number | null;
  isOrderable: boolean;
  descriptionMd: string | null;
  heroImageUrl: string | null;
  allergens: Allergen[];
  dietaryTags: DietaryTag[];
}): Promise<void> {
  const values = {
    squareCatalogObjectId: input.productId,
    slug: input.slug,
    sortOrder: input.sortOrder,
    leadTimeDays: input.leadTimeDays,
    orderCutoffTime: input.orderCutoffTime,
    allowedPickupTimes: input.allowedPickupTimes,
    maxUnitsPerDay: input.maxUnitsPerDay,
    isOrderable: input.isOrderable,
    descriptionMd: input.descriptionMd,
    heroImageUrl: input.heroImageUrl,
    allergens: input.allergens,
    dietaryTags: input.dietaryTags,
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

/** Upcoming "sold out today" 86 entries, oldest date first. */
export async function listAvailabilityOverrides(): Promise<{
  id: string;
  productId: string;
  locationId: string | null;
  date: StoreDate;
  reason: string | null;
  createdBy: string | null;
}[]> {
  const today = storeToday(new Date(), serverEnv().STORE_TIMEZONE);
  const rows = await db()
    .select()
    .from(productAvailabilityOverrides)
    .where(gte(productAvailabilityOverrides.date, today))
    .orderBy(asc(productAvailabilityOverrides.date));
  return rows.map((row) => ({
    id: row.id,
    productId: row.squareProductId,
    locationId: row.squareLocationId,
    date: row.date,
    reason: row.reason,
    createdBy: row.createdBy,
  }));
}

export async function addAvailabilityOverride(input: {
  productId: string;
  locationId: string;
  date: StoreDate;
  reason: string | null;
  createdBy: string | null;
}): Promise<void> {
  await db()
    .insert(productAvailabilityOverrides)
    .values({
      squareProductId: input.productId,
      squareLocationId: input.locationId,
      date: input.date,
      reason: input.reason,
      createdBy: input.createdBy,
    })
    .onConflictDoUpdate({
      target: [
        productAvailabilityOverrides.squareProductId,
        productAvailabilityOverrides.squareLocationId,
        productAvailabilityOverrides.date,
      ],
      set: { reason: input.reason, createdBy: input.createdBy },
    });
}

export async function removeAvailabilityOverride(id: string): Promise<void> {
  await db().delete(productAvailabilityOverrides).where(eq(productAvailabilityOverrides.id, id));
}
