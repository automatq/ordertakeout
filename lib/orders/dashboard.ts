import "server-only";

import { and, asc, desc, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { orderItems, orders, type Order, type OrderItem } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { addCalendarDays, storeToday, type StoreDate, type StoreTime } from "@/lib/scheduling/time";

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
}

export interface SlotGroup {
  time: StoreTime;
  orders: DashboardOrder[];
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
}

/**
 * Orders for the kitchen screen, grouped by pickup day and slot.
 *
 * Defaults to a window around today rather than everything: staff care about
 * what's coming, and the query must stay cheap as order history grows.
 */
export async function getDashboardData(daysAhead = 7): Promise<DashboardData> {
  const today = storeToday(new Date(), serverEnv().STORE_TIMEZONE);
  const until = addCalendarDays(today, daysAhead);

  const rows = await db()
    .select()
    .from(orders)
    .where(
      and(
        inArray(orders.status, [...ACTIVE_STATUSES]),
        gte(orders.pickupDate, today),
        lte(orders.pickupDate, until),
      ),
    )
    .orderBy(asc(orders.pickupDate), asc(orders.pickupTime), asc(orders.createdAt));

  const items = await loadItemsFor(rows.map((r) => r.id));

  const byDate = new Map<StoreDate, Map<StoreTime, DashboardOrder[]>>();
  for (const row of rows) {
    const slots = byDate.get(row.pickupDate) ?? new Map<StoreTime, DashboardOrder[]>();
    const slot = slots.get(row.pickupTime) ?? [];
    slot.push({ ...row, items: items.get(row.id) ?? [] });
    slots.set(row.pickupTime, slot);
    byDate.set(row.pickupDate, slots);
  }

  const days: DayGroup[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, slots]) => ({
      date,
      slots: [...slots.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([time, slotOrders]) => ({ time, orders: slotOrders })),
      orderCount: [...slots.values()].reduce((sum, o) => sum + o.length, 0),
    }));

  return {
    today,
    days,
    newOrderCount: rows.filter((r) => r.status === "paid").length,
  };
}

/** Every order for one pickup day, for the printable prep sheet. */
export async function getOrdersForDate(date: StoreDate): Promise<DashboardOrder[]> {
  const rows = await db()
    .select()
    .from(orders)
    .where(and(inArray(orders.status, [...VISIBLE_STATUSES]), sql`${orders.pickupDate} = ${date}`))
    .orderBy(asc(orders.pickupTime), asc(orders.createdAt));

  const items = await loadItemsFor(rows.map((r) => r.id));
  return rows.map((row) => ({ ...row, items: items.get(row.id) ?? [] }));
}

/** Recently completed or cancelled orders, for looking something up after the fact. */
export async function getRecentlyClosed(limit = 25): Promise<DashboardOrder[]> {
  const rows = await db()
    .select()
    .from(orders)
    .where(inArray(orders.status, ["completed", "canceled"]))
    .orderBy(desc(orders.updatedAt))
    .limit(limit);

  const items = await loadItemsFor(rows.map((r) => r.id));
  return rows.map((row) => ({ ...row, items: items.get(row.id) ?? [] }));
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
