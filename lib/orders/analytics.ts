import "server-only";

import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { orderItems, orders } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { addCalendarDays, storeToday, type StoreDate } from "@/lib/scheduling/time";

/**
 * Aggregates behind the staff sales screen.
 *
 * Bucketed by PICKUP DATE, not payment time. Every other staff view — the
 * queue, the prep sheet, the timeline — is organised by the day the food leaves
 * the shop, and `pickup_date` is already a store-local `date` column, so it
 * groups correctly without any timezone conversion. "Revenue on the 14th"
 * therefore means trays collected on the 14th.
 *
 * A consequence worth knowing: the window ends today, so pre-orders for future
 * days are deliberately excluded from the headline numbers and reported
 * separately as booked revenue. Mixing them would make "last 7 days" grow every
 * time someone ordered for next month.
 */

/** Money is only real once it's paid. Abandoned checkouts and cancellations are not sales. */
const REVENUE_STATUSES = ["paid", "preparing", "ready", "completed"] as const;

export const RANGES = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
] as const;

export type RangeDays = (typeof RANGES)[number]["days"];

export function parseRange(value: string | undefined): RangeDays {
  const parsed = Number(value);
  return RANGES.some((r) => r.days === parsed) ? (parsed as RangeDays) : 7;
}

export interface DayPoint {
  date: StoreDate;
  revenueCents: number;
  orderCount: number;
}

export interface PeriodTotals {
  revenueCents: number;
  orderCount: number;
  /** Zero when there were no orders — callers render a dash, not a divide-by-zero. */
  avgOrderCents: number;
  canceledCount: number;
}

export interface TopItem {
  name: string;
  quantity: number;
  revenueCents: number;
}

export interface SalesAnalytics {
  today: StoreDate;
  from: StoreDate;
  to: StoreDate;
  days: RangeDays;
  currency: string;
  current: PeriodTotals;
  /** The equal-length window immediately before this one, for the deltas. */
  previous: PeriodTotals;
  byDay: DayPoint[];
  topItems: TopItem[];
  upcoming: { revenueCents: number; orderCount: number };
}

/** Postgres returns sums and counts as strings; everything downstream wants numbers. */
const toNumber = (value: string | number | null): number => Number(value ?? 0);

export async function getSalesAnalytics(days: RangeDays): Promise<SalesAnalytics> {
  const today = storeToday(new Date(), serverEnv().STORE_TIMEZONE);
  const to = today;
  const from = addCalendarDays(today, -(days - 1));
  const previousTo = addCalendarDays(from, -1);
  const previousFrom = addCalendarDays(previousTo, -(days - 1));

  // One grouped query spans both windows: the previous period is just a
  // different slice of the same rows, so there's no reason to ask twice.
  const [revenueRows, canceledRows, topItemRows, upcomingRows] = await Promise.all([
    db()
      .select({
        date: orders.pickupDate,
        revenueCents: sql<string>`coalesce(sum(${orders.totalCents}), 0)`,
        orderCount: sql<string>`count(*)`,
        currency: sql<string>`min(${orders.currency})`,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.status, [...REVENUE_STATUSES]),
          gte(orders.pickupDate, previousFrom),
          lte(orders.pickupDate, to),
        ),
      )
      .groupBy(orders.pickupDate),

    db()
      .select({ date: orders.pickupDate, count: sql<string>`count(*)` })
      .from(orders)
      .where(
        and(
          eq(orders.status, "canceled"),
          gte(orders.pickupDate, previousFrom),
          lte(orders.pickupDate, to),
        ),
      )
      .groupBy(orders.pickupDate),

    db()
      .select({
        name: orderItems.nameSnapshot,
        quantity: sql<string>`sum(${orderItems.quantity})`,
        revenueCents: sql<string>`sum(${orderItems.totalPriceCents})`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(
        and(
          inArray(orders.status, [...REVENUE_STATUSES]),
          gte(orders.pickupDate, from),
          lte(orders.pickupDate, to),
        ),
      )
      .groupBy(orderItems.nameSnapshot)
      .orderBy(desc(sql`sum(${orderItems.quantity})`))
      .limit(6),

    db()
      .select({
        revenueCents: sql<string>`coalesce(sum(${orders.totalCents}), 0)`,
        orderCount: sql<string>`count(*)`,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.status, [...REVENUE_STATUSES]),
          gte(orders.pickupDate, addCalendarDays(today, 1)),
        ),
      ),
  ]);

  const revenueByDate = new Map(revenueRows.map((r) => [r.date, r]));
  const canceledByDate = new Map(canceledRows.map((r) => [r.date, toNumber(r.count)]));

  const totalsFor = (start: StoreDate, end: StoreDate): PeriodTotals => {
    let revenueCents = 0;
    let orderCount = 0;
    let canceledCount = 0;

    for (const [date, row] of revenueByDate) {
      if (date < start || date > end) continue;
      revenueCents += toNumber(row.revenueCents);
      orderCount += toNumber(row.orderCount);
    }
    for (const [date, count] of canceledByDate) {
      if (date < start || date > end) continue;
      canceledCount += count;
    }

    return {
      revenueCents,
      orderCount,
      avgOrderCents: orderCount === 0 ? 0 : Math.round(revenueCents / orderCount),
      canceledCount,
    };
  };

  // Every day in the window, including the empty ones — a chart that silently
  // drops zero-revenue days misreads as "we were busy all week".
  const byDay: DayPoint[] = [];
  for (let i = 0; i < days; i++) {
    const date = addCalendarDays(from, i);
    const row = revenueByDate.get(date);
    byDay.push({
      date,
      revenueCents: toNumber(row?.revenueCents ?? 0),
      orderCount: toNumber(row?.orderCount ?? 0),
    });
  }

  return {
    today,
    from,
    to,
    days,
    currency: revenueRows.find((r) => r.currency)?.currency ?? "USD",
    current: totalsFor(from, to),
    previous: totalsFor(previousFrom, previousTo),
    byDay,
    topItems: topItemRows.map((r) => ({
      name: r.name,
      quantity: toNumber(r.quantity),
      revenueCents: toNumber(r.revenueCents),
    })),
    upcoming: {
      revenueCents: toNumber(upcomingRows[0]?.revenueCents ?? 0),
      orderCount: toNumber(upcomingRows[0]?.orderCount ?? 0),
    },
  };
}
