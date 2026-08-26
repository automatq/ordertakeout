import "server-only";

import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  blackoutDates as blackoutDatesTable,
  orderItems,
  orders,
  productAvailabilityOverrides,
  productsConfig,
  slotCapacity,
  slotHolds,
  type OrderStatus,
} from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { getStoreLocation } from "@/lib/locations/server";
import { getSlotCapacityDefault } from "@/lib/settings/capacity";
import {
  MAX_ORDER_HORIZON_DAYS,
  SLOT_HOLD_TTL_MINUTES,
} from "@/lib/store";

import {
  computeAvailability,
  productDayKey,
  slotKey,
  validatePickupSelection,
  type AvailabilityInput,
  type AvailabilityResult,
  type CartLine,
  type ProductRule,
  type SelectionRejection,
} from "./availability";
import { addCalendarDays, normalizeTime, storeToday, type StoreDate, type StoreTime } from "./time";

/**
 * Database layer for the scheduling engine.
 *
 * Everything here does one job: gather the facts the pure engine in
 * availability.ts needs, then hand off. The rules themselves live there so they
 * stay testable without a database.
 */

type Database = ReturnType<typeof db>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Anything that can run a query — the pool or an open transaction.
 *
 * Every read below takes one of these rather than reaching for `db()` directly.
 * Inside claimSlot() the reads MUST run on the transaction: calling `db()` there
 * would check out a second pooled connection while the first is still held, which
 * deadlocks the moment concurrent checkouts exhaust the pool — precisely when
 * the locking matters most.
 */
type Executor = Database | Transaction;

/**
 * Orders that occupy a pickup slot.
 *
 * `pending_payment` is deliberately absent — an order mid-checkout is
 * represented by its slot hold instead, so counting both would double-book
 * against the customer who is currently paying.
 */
const COMMITTED_STATUSES = [
  "paid",
  "preparing",
  "ready",
  "completed",
] as const satisfies readonly OrderStatus[];

export async function loadProductRules(
  productIds: readonly string[],
  exec: Executor = db(),
): Promise<ProductRule[]> {
  if (productIds.length === 0) return [];

  const rows = await exec
    .select()
    .from(productsConfig)
    .where(inArray(productsConfig.squareCatalogObjectId, [...productIds]));

  return rows.map((row) => ({
    productId: row.squareCatalogObjectId,
    leadTimeDays: row.leadTimeDays,
    // Postgres `time` columns come back as HH:mm:ss; the engine compares times
    // as strings, so they must be normalised before they get there.
    orderCutoffTime: normalizeTime(row.orderCutoffTime),
    allowedPickupTimes: row.allowedPickupTimes.map(normalizeTime),
    maxUnitsPerDay: row.maxUnitsPerDay,
    isOrderable: row.isOrderable,
  }));
}

/**
 * Gather every input the availability engine needs for a given cart.
 *
 * Usage is scoped to the date range actually being offered rather than the whole
 * table, so this stays cheap as order history grows.
 */
export async function loadAvailabilityInput(
  cart: readonly CartLine[],
  exec: Executor = db(),
  locationId?: string,
  /**
   * How far ahead to build. Defaults to the full bookable horizon, which is
   * what the checkout guard needs; the storefront passes a shorter preview
   * window so it does not query, serialise and ship five weeks of slots the
   * picker will discard. Narrowing this narrows the supporting queries too.
   */
  horizonDays: number = MAX_ORDER_HORIZON_DAYS,
): Promise<AvailabilityInput> {
  const location = locationId ? await getStoreLocation(locationId) : null;
  const timeZone = location?.timezone ?? serverEnv().STORE_TIMEZONE;
  const now = new Date();
  const today = storeToday(now, timeZone);
  const lastDate = addCalendarDays(today, horizonDays);

  const rules = await loadProductRules(cart.map((line) => line.productId), exec);
  // Staff-configurable, per location, with the compiled-in constant only as a
  // last resort — see lib/settings/capacity.ts for why this stopped being a
  // hardcoded number.
  const defaultSlotCapacity = await getSlotCapacityDefault(locationId);

  const [blackouts, capacities, slotCounts, productCounts, soldOutOverrides] = await Promise.all([
    exec
      .select({ date: blackoutDatesTable.date })
      .from(blackoutDatesTable)
      .where(
        and(
          sql`${blackoutDatesTable.date} >= ${today}`,
          sql`${blackoutDatesTable.date} <= ${lastDate}`,
          locationId
            ? or(
                eq(blackoutDatesTable.squareLocationId, locationId),
                isNull(blackoutDatesTable.squareLocationId),
              )
            : undefined,
        ),
      ),
    exec
      .select()
      .from(slotCapacity)
      .where(
        and(
          sql`${slotCapacity.pickupDate} >= ${today}`,
          sql`${slotCapacity.pickupDate} <= ${lastDate}`,
          locationId
            ? or(eq(slotCapacity.squareLocationId, locationId), isNull(slotCapacity.squareLocationId))
            : undefined,
        ),
      ),
    countOrdersPerSlot(today, lastDate, exec, locationId),
    countUnitsPerProductPerDay(today, lastDate, exec, locationId),
    exec
      .select({
        productId: productAvailabilityOverrides.squareProductId,
        date: productAvailabilityOverrides.date,
      })
      .from(productAvailabilityOverrides)
      .where(
        and(
          sql`${productAvailabilityOverrides.date} >= ${today}`,
          sql`${productAvailabilityOverrides.date} <= ${lastDate}`,
          locationId
            ? or(
                eq(productAvailabilityOverrides.squareLocationId, locationId),
                isNull(productAvailabilityOverrides.squareLocationId),
              )
            : undefined,
        ),
      ),
  ]);

  return {
    now,
    timeZone,
    cart,
    rules,
    horizonDays,
    blackoutDates: new Set(blackouts.map((b) => b.date)),
    productDateBlocks: new Set(
      soldOutOverrides.map((row) => productDayKey(row.productId, row.date)),
    ),
    slotUsage: new Map(slotCounts.map((r) => [slotKey(r.date, r.time), r.count])),
    slotCapacityOverrides: new Map(
      capacities
        .sort((a, b) => Number(Boolean(a.squareLocationId)) - Number(Boolean(b.squareLocationId)))
        .map((c) => [slotKey(c.pickupDate, c.pickupTime), c.maxOrders]),
    ),
    defaultSlotCapacity,
    productDayUsage: new Map(
      productCounts.map((r) => [productDayKey(r.productId, r.date), r.units]),
    ),
  };
}

export async function getAvailability(cart: readonly CartLine[]): Promise<AvailabilityResult> {
  return computeAvailability(await loadAvailabilityInput(cart));
}

/**
 * How many orders already occupy each slot: committed orders, plus orders still
 * mid-checkout that hold a live (unexpired) claim on the slot.
 */
async function countOrdersPerSlot(
  from: StoreDate,
  to: StoreDate,
  exec: Executor,
  locationId?: string,
): Promise<{ date: StoreDate; time: StoreTime; count: number }[]> {
  const rows = await exec.execute<{ date: string; time: string; count: string }>(sql`
    SELECT pickup_date AS date, pickup_time AS time, COUNT(*)::text AS count
    FROM (
      SELECT o.pickup_date, o.pickup_time
      FROM ${orders} o
      WHERE o.status = ANY(${sql.raw(`ARRAY['${COMMITTED_STATUSES.join("','")}']::order_status[]`)})
        AND o.pickup_date BETWEEN ${from} AND ${to}
        ${locationId ? sql`AND o.square_location_id = ${locationId}` : sql``}
      UNION ALL
      SELECT h.pickup_date, h.pickup_time
      FROM ${slotHolds} h
      WHERE h.expires_at > now()
        AND h.pickup_date BETWEEN ${from} AND ${to}
        ${locationId ? sql`AND h.square_location_id = ${locationId}` : sql``}
    ) occupied
    GROUP BY pickup_date, pickup_time
  `);

  return rows.map((r) => ({
    date: r.date,
    time: normalizeTime(r.time),
    count: Number(r.count),
  }));
}

/** Units of each product already committed per pickup day, for production caps. */
async function countUnitsPerProductPerDay(
  from: StoreDate,
  to: StoreDate,
  exec: Executor,
  locationId?: string,
): Promise<{ productId: string; date: StoreDate; units: number }[]> {
  const rows = await exec.execute<{ product_id: string; date: string; units: string }>(sql`
    SELECT COALESCE(i.square_product_id, i.square_catalog_object_id) AS product_id,
           o.pickup_date AS date,
           SUM(i.quantity)::text AS units
    FROM ${orderItems} i
    JOIN ${orders} o ON o.id = i.order_id
    WHERE o.pickup_date BETWEEN ${from} AND ${to}
      ${locationId ? sql`AND o.square_location_id = ${locationId}` : sql``}
      AND (
        o.status = ANY(${sql.raw(`ARRAY['${COMMITTED_STATUSES.join("','")}']::order_status[]`)})
        OR EXISTS (
          SELECT 1 FROM ${slotHolds} h
          WHERE h.order_id = o.id AND h.expires_at > now()
        )
      )
    GROUP BY COALESCE(i.square_product_id, i.square_catalog_object_id), o.pickup_date
  `);

  return rows.map((r) => ({
    productId: r.product_id,
    date: r.date,
    units: Number(r.units),
  }));
}

export type ClaimResult =
  | { ok: true; holdId: string; expiresAt: Date }
  | { ok: false; rejection: SelectionRejection };

/**
 * Atomically claim a pickup slot for an order that is about to be paid for.
 *
 * This is what makes client question 9 ("prevent overbooking") actually true
 * rather than approximately true. Checking availability and then inserting is a
 * classic check-then-act race: two customers both read "1 space left" and both
 * succeed. Here the transaction takes a Postgres advisory lock on the slot
 * first, so the second request blocks until the first has committed its hold and
 * then re-reads the real count.
 *
 * An advisory lock is used rather than SELECT ... FOR UPDATE because most slots
 * have no `slot_capacity` row to lock — capacity is usually the default. The
 * lock is transaction-scoped, so it is released on commit or rollback without
 * any cleanup path. `hashtext` can in principle collide, which would harmlessly
 * serialise two unrelated slots.
 *
 * The hold expires on its own (SLOT_HOLD_TTL_MINUTES) so an abandoned checkout
 * frees the slot without needing a compensating action.
 */
export async function claimSlot(
  orderId: string,
  cart: readonly CartLine[],
  selection: { date: StoreDate; time: StoreTime },
  locationId?: string,
): Promise<ClaimResult> {
  return db().transaction((tx) => reserveSlotWithin(tx, orderId, cart, selection, locationId));
}

/**
 * The locked reservation itself, usable inside a caller's transaction.
 *
 * Order creation needs the order row, its line items and the hold to commit
 * together — a hold pointing at an order that failed to insert would block a slot
 * for nothing. Exposing this lets `createPendingOrder` do all four in one
 * transaction instead of chaining separate ones.
 */
export async function reserveSlotWithin(
  tx: Transaction,
  orderId: string,
  cart: readonly CartLine[],
  selection: { date: StoreDate; time: StoreTime },
  locationId?: string,
): Promise<ClaimResult> {
  const time = normalizeTime(selection.time);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${locationId ?? "legacy"}:${slotKey(selection.date, time)}`}))`);

  // Re-read availability *inside* the lock. Anything checked before the lock
  // was taken is stale by definition.
  const input = await loadAvailabilityInput(cart, tx, locationId);
  const verdict = validatePickupSelection(input, { date: selection.date, time });
  if (!verdict.ok) {
    return { ok: false, rejection: verdict.rejection };
  }

  const expiresAt = new Date(Date.now() + SLOT_HOLD_TTL_MINUTES * 60_000);
  const [hold] = await tx
    .insert(slotHolds)
    .values({ squareLocationId: locationId ?? null, pickupDate: selection.date, pickupTime: time, orderId, expiresAt })
    .returning({ id: slotHolds.id });

  if (!hold) {
    throw new Error("Failed to create slot hold");
  }
  return { ok: true, holdId: hold.id, expiresAt };
}

/** Release a hold after payment succeeds, fails, or the customer backs out. */
export async function releaseSlotHold(holdId: string): Promise<void> {
  await db().delete(slotHolds).where(eq(slotHolds.id, holdId));
}

/**
 * Delete holds whose checkout never completed.
 *
 * Expired holds are already ignored by the availability queries (`expires_at >
 * now()`), so this is housekeeping rather than correctness — but without it the
 * table grows forever. Safe to run on a cron.
 */
export async function sweepExpiredHolds(): Promise<number> {
  const deleted = await db()
    .delete(slotHolds)
    .where(sql`${slotHolds.expiresAt} <= now()`)
    .returning({ id: slotHolds.id });
  return deleted.length;
}

/** Holds still live for a slot — used by the staff dashboard's capacity view. */
export async function liveHoldsForSlot(
  date: StoreDate,
  time: StoreTime,
  locationId?: string,
): Promise<number> {
  const rows = await db()
    .select({ id: slotHolds.id })
    .from(slotHolds)
    .where(
      and(
        eq(slotHolds.pickupDate, date),
        eq(slotHolds.pickupTime, normalizeTime(time)),
        locationId ? eq(slotHolds.squareLocationId, locationId) : undefined,
        gt(slotHolds.expiresAt, new Date()),
      ),
    );
  return rows.length;
}
