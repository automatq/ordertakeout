import "server-only";

import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  orderItems,
  orders,
  pickupVerifications,
  productsConfig,
  slotCapacity,
  type Order,
  type OrderItem,
  type PickupVerification,
} from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { addCalendarDays, normalizeTime, storeToday, type StoreDate, type StoreTime } from "@/lib/scheduling/time";
import { getStoreLocationsSafe } from "@/lib/locations/server";
import { listPauseSettings, type PauseOverview } from "@/lib/settings/pause";
import type { StoreLocation } from "@/lib/locations/types";
import { DEFAULT_MAX_ORDERS_PER_SLOT } from "@/lib/store";

/**
 * Queries backing the staff order screen.
 *
 * Unpaid orders are excluded throughout. An order sitting in `pending_payment`
 * is someone mid-checkout, and putting it on the kitchen screen would have staff
 * baking trays nobody has paid for.
 */

const VISIBLE_STATUSES = ["paid", "preparing", "ready", "completed", "canceled"] as const;
const ACTIVE_STATUSES = ["paid", "preparing", "ready"] as const;

export interface DashboardOrder extends Order {
  items: OrderItem[];
  pickupVerification: PickupVerification | null;
}

export interface SlotGroup {
  time: StoreTime;
  orders: DashboardOrder[];
  /** Actual order capacity across the locations represented by this view. */
  capacity: number;
}

export interface DayGroup {
  date: StoreDate;
  slots: SlotGroup[];
  orderCount: number;
}

export interface DashboardData {
  today: StoreDate;
  days: DayGroup[];
  /** Paid but not yet started, across all days — the "needs attention" count. */
  newOrderCount: number;
  locations: StoreLocation[];
  /** Current pause-ordering switches, for the one-tap header toggle. */
  orderingPause: PauseOverview;
}

type LocationSnapshotOrder = Pick<
  Order,
  | "squareLocationId"
  | "pickupLocationName"
  | "pickupLocationAddress"
  | "pickupLocationCity"
  | "pickupLocationTimezone"
  | "pickupLocationPhone"
  | "pickupLocationHours"
  | "currency"
>;

/** Keep operations usable from immutable order snapshots during a Square outage. */
export function mergeOperationalLocations(
  liveLocations: readonly StoreLocation[],
  rows: readonly LocationSnapshotOrder[],
): StoreLocation[] {
  const merged = new Map<string, StoreLocation>();
  for (const order of rows) {
    if (!order.squareLocationId) continue;
    merged.set(order.squareLocationId, {
      id: order.squareLocationId,
      name: order.pickupLocationName ?? order.squareLocationId,
      address: order.pickupLocationAddress ?? "",
      city: order.pickupLocationCity,
      timezone: order.pickupLocationTimezone,
      currency: order.currency,
      phone: order.pickupLocationPhone,
      businessHours: order.pickupLocationHours ?? [],
      coordinates: null,
    });
  }
  // Current Square metadata enriches the snapshot when it is available.
  for (const location of liveLocations) merged.set(location.id, location);
  return [...merged.values()];
}

/** Group database rows on the same normalized wall-clock slot. */
export function groupDashboardOrders(
  rows: readonly DashboardOrder[],
): Map<StoreDate, Map<StoreTime, DashboardOrder[]>> {
  const byDate = new Map<StoreDate, Map<StoreTime, DashboardOrder[]>>();
  for (const row of rows) {
    const slots = byDate.get(row.pickupDate) ?? new Map<StoreTime, DashboardOrder[]>();
    const pickupTime = normalizeTime(row.pickupTime);
    const slot = slots.get(pickupTime) ?? [];
    slot.push(row);
    slots.set(pickupTime, slot);
    byDate.set(row.pickupDate, slots);
  }
  return byDate;
}

/**
 * Orders for the kitchen screen, grouped by pickup day and slot.
 *
 * Defaults to a window around today rather than everything: staff care about
 * what's coming, and the query must stay cheap as order history grows.
 */
export async function getDashboardData(daysAhead = 7, locationId?: string): Promise<DashboardData> {
  const today = storeToday(new Date(), serverEnv().STORE_TIMEZONE);
  const until = addCalendarDays(today, daysAhead);

  const [rows, locations, ruleRows, capacityRows] = await Promise.all([
    db()
      .select()
      .from(orders)
      .where(
        and(
          inArray(orders.status, [...ACTIVE_STATUSES]),
          gte(orders.pickupDate, today),
          lte(orders.pickupDate, until),
          locationId ? sql`${orders.squareLocationId} = ${locationId}` : undefined,
        ),
      )
      .orderBy(asc(orders.pickupDate), asc(orders.pickupTime), asc(orders.createdAt)),
    getStoreLocationsSafe(),
    db()
      .select({ times: productsConfig.allowedPickupTimes })
      .from(productsConfig)
      .where(eq(productsConfig.isOrderable, true)),
    db()
      .select()
      .from(slotCapacity)
      .where(
        and(
          gte(slotCapacity.pickupDate, today),
          lte(slotCapacity.pickupDate, until),
          locationId
            ? or(eq(slotCapacity.squareLocationId, locationId), isNull(slotCapacity.squareLocationId))
            : undefined,
        ),
      ),
  ]);

  const [items, verifications] = await Promise.all([
    loadItemsFor(rows.map((row) => row.id)),
    loadPickupVerificationsFor(rows.map((row) => row.id)),
  ]);

  const byDate = groupDashboardOrders(
    rows.map((row) => ({
      ...row,
      items: items.get(row.id) ?? [],
      pickupVerification: verifications.get(row.id) ?? null,
    })),
  );

  const configuredTimes = [...new Set(ruleRows.flatMap((row) => row.times.map(normalizeTime)))].sort();
  for (const slots of byDate.values()) {
    for (const time of configuredTimes) {
      if (!slots.has(time)) slots.set(time, []);
    }
  }

  const rowLocationIds = [
    ...new Set(
      rows.map((order) => order.squareLocationId).filter((id): id is string => Boolean(id)),
    ),
  ];

  const capacityFor = (date: StoreDate, time: StoreTime): number => {
    const normalized = normalizeTime(time);
    const globalOverride = capacityRows.find(
      (row) =>
        row.squareLocationId === null &&
        row.pickupDate === date &&
        normalizeTime(row.pickupTime) === normalized,
    )?.maxOrders;
    const representedLocations = locationId
      ? [locationId]
      : locations.length
        ? locations.map((location) => location.id)
        : rowLocationIds.length
          ? rowLocationIds
          : ["legacy"];

    return representedLocations.reduce((total, id) => {
      const ownOverride = capacityRows.find(
        (row) =>
          row.squareLocationId === id &&
          row.pickupDate === date &&
          normalizeTime(row.pickupTime) === normalized,
      )?.maxOrders;
      return total + (ownOverride ?? globalOverride ?? DEFAULT_MAX_ORDERS_PER_SLOT);
    }, 0);
  };

  const days: DayGroup[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, slots]) => ({
      date,
      slots: [...slots.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([time, slotOrders]) => ({ time, orders: slotOrders, capacity: capacityFor(date, time) })),
      orderCount: [...slots.values()].reduce((sum, o) => sum + o.length, 0),
    }));

  return {
    today,
    days,
    newOrderCount: rows.filter((r) => r.status === "paid").length,
    locations: mergeOperationalLocations(locations, rows),
    orderingPause: await listPauseSettings(locations.map((location) => location.id)),
  };
}

/** Every order for one pickup day, for the printable prep sheet. */
export async function getOrdersForDate(date: StoreDate, locationId?: string): Promise<DashboardOrder[]> {
  const rows = await db()
    .select()
    .from(orders)
    .where(and(
      inArray(orders.status, [...VISIBLE_STATUSES]),
      sql`${orders.pickupDate} = ${date}`,
      locationId ? sql`${orders.squareLocationId} = ${locationId}` : undefined,
    ))
    .orderBy(asc(orders.pickupTime), asc(orders.createdAt));

  const [items, verifications] = await Promise.all([
    loadItemsFor(rows.map((row) => row.id)),
    loadPickupVerificationsFor(rows.map((row) => row.id)),
  ]);
  return rows.map((row) => ({
    ...row,
    items: items.get(row.id) ?? [],
    pickupVerification: verifications.get(row.id) ?? null,
  }));
}

export interface ClosedOrderQuery {
  /** Matches an order number, customer name or phone number, case-insensitively. */
  search?: string;
  status?: "completed" | "canceled";
  /** Pickup dates, inclusive. */
  from?: StoreDate;
  to?: StoreDate;
  locationId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Search closed orders.
 *
 * The Completed screen exists to look something up after the fact, but it could
 * only ever show the last 25 rows by `updatedAt` — no search, no filter, no date
 * range. If the order you needed wasn't in that window it was unreachable from
 * the UI entirely. Limit and offset now back the URL pager.
 *
 * Filtering happens in SQL rather than in the page so the query stays cheap as
 * order history grows.
 */
export async function searchClosedOrders(
  query: ClosedOrderQuery = {},
): Promise<DashboardOrder[]> {
  const { search, status, from, to, locationId, limit = 25, offset = 0 } = query;

  const conditions = [
    status
      ? inArray(orders.status, [status])
      : inArray(orders.status, ["completed", "canceled"]),
  ];

  if (search?.trim()) {
    // `%` and `_` in a customer's own name would otherwise act as wildcards.
    const term = `%${search.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conditions.push(
      sql`(${orders.orderNumber} ILIKE ${term} OR ${orders.customerName} ILIKE ${term} OR ${orders.customerPhone} ILIKE ${term})`,
    );
  }

  if (from) conditions.push(gte(orders.pickupDate, from));
  if (to) conditions.push(lte(orders.pickupDate, to));
  if (locationId) conditions.push(sql`${orders.squareLocationId} = ${locationId}`);

  const rows = await db()
    .select()
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.updatedAt))
    .limit(Math.max(1, limit))
    .offset(Math.max(0, offset));

  const [items, verifications] = await Promise.all([
    loadItemsFor(rows.map((row) => row.id)),
    loadPickupVerificationsFor(rows.map((row) => row.id)),
  ]);
  return rows.map((row) => ({
    ...row,
    items: items.get(row.id) ?? [],
    pickupVerification: verifications.get(row.id) ?? null,
  }));
}

/** One query for all line items, rather than one per order. */
async function loadItemsFor(orderIds: string[]): Promise<Map<string, OrderItem[]>> {
  if (orderIds.length === 0) return new Map();

  const rows = await db()
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderIds))
    .orderBy(asc(orderItems.nameSnapshot));

  const grouped = new Map<string, OrderItem[]>();
  for (const item of rows) {
    const list = grouped.get(item.orderId) ?? [];
    list.push(item);
    grouped.set(item.orderId, list);
  }
  return grouped;
}

async function loadPickupVerificationsFor(
  orderIds: string[],
): Promise<Map<string, PickupVerification>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db()
    .select()
    .from(pickupVerifications)
    .where(inArray(pickupVerifications.orderId, orderIds));
  return new Map(rows.map((row) => [row.orderId, row]));
}

/**
 * Totals per product for a pickup day — what the kitchen actually bakes from.
 * "4 PM: 3 × 25pc Ube" is more use at 5am than a list of customer names.
 */
export function summariseProduction(dayOrders: readonly DashboardOrder[]): {
  name: string;
  quantity: number;
}[] {
  const totals = new Map<string, number>();
  for (const order of dayOrders) {
    if (order.status === "canceled") continue;
    for (const item of order.items) {
      totals.set(item.nameSnapshot, (totals.get(item.nameSnapshot) ?? 0) + item.quantity);
    }
  }
  return [...totals.entries()]
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
}
