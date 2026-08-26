import "server-only";

import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  orderItems,
  orders,
  pickupVerifications,
  productsConfig,
  slotCapacity,
  slotHolds,
  type Order,
  type OrderItem,
  type PickupVerification,
} from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { isAttemptLeaseStale } from "@/lib/orders/payment-state";
import { addCalendarDays, normalizeTime, storeToday, type StoreDate, type StoreTime } from "@/lib/scheduling/time";
import { getStoreLocationsSafe } from "@/lib/locations/server";
import { listPauseSettings, type PauseOverview } from "@/lib/settings/pause";
import type { StoreLocation } from "@/lib/locations/types";
import { listSlotCapacityDefaults } from "@/lib/settings/capacity";
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

export interface InCheckoutOrder {
  id: string;
  orderNumber: string;
  pickupDate: StoreDate;
  pickupTime: StoreTime;
  totalCents: number;
  currency: string;
  createdAt: Date;
  /** Live reservation expiry, when one still exists. */
  holdExpiresAt: Date | null;
  /** Safe to release: no live hold and no active payment attempt lease. */
  stale: boolean;
}

export interface DashboardData {
  today: StoreDate;
  days: DayGroup[];
  /** Paid but not yet started, across all days — the "needs attention" count. */
  newOrderCount: number;
  locations: StoreLocation[];
  /** Current pause-ordering switches, for the one-tap header toggle. */
  orderingPause: PauseOverview;
  /**
   * pending_payment orders in the window — customers mid-checkout, or stuck
   * checkouts. Previously invisible in every staff view.
   */
  inCheckout: InCheckoutOrder[];
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
      country: null,
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
/**
 * How many orders a pickup slot can take, across the locations on screen.
 *
 * Four things can answer this and the order matters:
 *
 *   1. a per-date row for that location   — staff capped one branch on one day
 *   2. a per-date row for all locations   — staff capped everyone on one day
 *   3. the location's configured default  — set in Settings
 *   4. the shop-wide configured default   — set in Settings
 *   5. the compiled-in fallback           — nothing has ever been configured
 *
 * A per-date row beating the standing default is the whole point of the
 * per-date control; if it did not, closing a single afternoon would be
 * impossible without changing the everyday number.
 *
 * Pure, and exported, because it used to be a closure resolving step 3 and 4 to
 * a hardcoded 5. The storefront honoured what the bakery set, this screen did
 * not, and the two quietly disagreed — a shop with a 30-order default saw
 * "1 of 15" here. Nobody would have found that except by adding up the numbers.
 */
export function resolveSlotCapacity(
  date: StoreDate,
  time: StoreTime,
  representedLocations: readonly string[],
  sources: {
    perDate: readonly {
      squareLocationId: string | null;
      pickupDate: string;
      pickupTime: string;
      maxOrders: number;
    }[];
    defaults: readonly { locationId: string | null; maxOrdersPerSlot: number }[];
  },
): number {
  // Postgres hands back HH:mm:ss where the UI uses HH:mm.
  const normalized = normalizeTime(time);
  const perDateFor = (id: string | null) =>
    sources.perDate.find(
      (row) =>
        row.squareLocationId === id &&
        row.pickupDate === date &&
        normalizeTime(row.pickupTime) === normalized,
    )?.maxOrders;

  const everywhereToday = perDateFor(null);
  const globalDefault = sources.defaults.find((row) => row.locationId === null)?.maxOrdersPerSlot;
  const defaultFor = (id: string) =>
    sources.defaults.find((row) => row.locationId === id)?.maxOrdersPerSlot ??
    globalDefault ??
    DEFAULT_MAX_ORDERS_PER_SLOT;

  return representedLocations.reduce(
    (total, id) => total + (perDateFor(id) ?? everywhereToday ?? defaultFor(id)),
    0,
  );
}

export async function getDashboardData(daysAhead = 7, locationId?: string): Promise<DashboardData> {
  const today = storeToday(new Date(), serverEnv().STORE_TIMEZONE);
  const until = addCalendarDays(today, daysAhead);

  const [rows, locations, ruleRows, capacityRows, capacityDefaults] = await Promise.all([
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
    listSlotCapacityDefaults(),
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

  const representedLocations = locationId
    ? [locationId]
    : locations.length
      ? locations.map((location) => location.id)
      : rowLocationIds.length
        ? rowLocationIds
        : ["legacy"];

  const capacityFor = (date: StoreDate, time: StoreTime): number =>
    resolveSlotCapacity(date, time, representedLocations, {
      perDate: capacityRows,
      defaults: capacityDefaults,
    });

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
    inCheckout: await loadInCheckoutOrders(today, until, locationId),
  };
}

/**
 * pending_payment orders holding (or having held) capacity. A row with a live
 * slot hold is a customer at the card form right now; one with no live hold
 * and a stale payment lease is a stuck checkout staff can safely release.
 */
async function loadInCheckoutOrders(
  today: StoreDate,
  until: StoreDate,
  locationId?: string,
): Promise<InCheckoutOrder[]> {
  const now = new Date();
  const rows = await db()
    .select({ order: orders, holdExpiresAt: slotHolds.expiresAt })
    .from(orders)
    .leftJoin(
      slotHolds,
      and(eq(slotHolds.orderId, orders.id), gt(slotHolds.expiresAt, now)),
    )
    .where(
      and(
        eq(orders.status, "pending_payment"),
        gte(orders.pickupDate, today),
        lte(orders.pickupDate, until),
        locationId ? sql`${orders.squareLocationId} = ${locationId}` : undefined,
      ),
    )
    .orderBy(asc(orders.createdAt));

  return rows.map(({ order, holdExpiresAt }) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    pickupDate: order.pickupDate,
    pickupTime: normalizeTime(order.pickupTime),
    totalCents: order.totalCents,
    currency: order.currency,
    createdAt: order.createdAt,
    holdExpiresAt,
    stale:
      holdExpiresAt === null &&
      (!order.paymentAttemptKey ||
        isAttemptLeaseStale(order.paymentAttemptStartedAt ?? order.updatedAt, now)),
  }));
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
/** The one condition builder both the list and its count share — they must never drift. */
function closedOrderConditions(query: ClosedOrderQuery) {
  const { search, status, from, to, locationId } = query;
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
  return conditions;
}

export async function countClosedOrders(query: ClosedOrderQuery = {}): Promise<number> {
  const [row] = await db()
    .select({ count: sql<string>`count(*)` })
    .from(orders)
    .where(and(...closedOrderConditions(query)));
  return Number(row?.count ?? 0);
}

export async function searchClosedOrders(
  query: ClosedOrderQuery = {},
): Promise<DashboardOrder[]> {
  const { limit = 25, offset = 0 } = query;

  const rows = await db()
    .select()
    .from(orders)
    .where(and(...closedOrderConditions(query)))
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
