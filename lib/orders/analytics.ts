import "server-only";

import { and, desc, eq, gte, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";

import { db } from "@/lib/db";
import { loyaltyEntries, orderItems, orderRefunds, orders } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import {
  addCalendarDays,
  assertStoreDate,
  daysBetween,
  normalizeTime,
  storeToday,
  type StoreDate,
  type StoreTime,
} from "@/lib/scheduling/time";

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

/** The current DoorDash/Uber Eats uplift the owner asked us to compare against. */
export const MARKETPLACE_FEE_RATE = 0.15;

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

const MAX_ANALYTICS_DAYS = 366;

export interface AnalyticsWindow {
  from: StoreDate;
  to: StoreDate;
  /** Set when the window came from a preset link rather than explicit dates. */
  preset?: RangeDays;
}

/**
 * Explicit from/to dates win; otherwise the preset links keep working. An
 * invalid custom range falls back to the default preset rather than erroring —
 * a hand-edited URL should degrade, not break the sales screen.
 */
export function parseAnalyticsWindow(params: {
  range?: string;
  from?: string;
  to?: string;
  today: StoreDate;
}): AnalyticsWindow {
  if (params.from && params.to) {
    try {
      const from = assertStoreDate(params.from);
      const to = assertStoreDate(params.to);
      const span = daysBetween(from, to);
      if (isRealCalendarDate(from) && isRealCalendarDate(to) && span >= 0 && span < MAX_ANALYTICS_DAYS) {
        return { from, to };
      }
    } catch {
      // fall through to the preset
    }
  }
  const days = parseRange(params.range);
  return { from: addCalendarDays(params.today, -(days - 1)), to: params.today, preset: days };
}

function isRealCalendarDate(date: StoreDate): boolean {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

export interface WeekdayPoint {
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  label: string;
  revenueCents: number;
  orderCount: number;
  /** How many of this weekday fell inside the window — context for totals. */
  occurrences: number;
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Pure: totals per weekday from the already-built per-day series. */
export function aggregateByWeekday(byDay: readonly DayPoint[]): WeekdayPoint[] {
  const points = WEEKDAY_LABELS.map((label, weekday) => ({
    weekday,
    label,
    revenueCents: 0,
    orderCount: 0,
    occurrences: 0,
  }));
  for (const day of byDay) {
    // The date is a store-local calendar date; parsing it as UTC midnight gives
    // the correct weekday without involving the server's zone.
    const weekday = (new Date(`${day.date}T00:00:00Z`).getUTCDay() + 6) % 7;
    const point = points[weekday]!;
    point.revenueCents += day.revenueCents;
    point.orderCount += day.orderCount;
    point.occurrences += 1;
  }
  return points;
}

export interface SlotPoint {
  time: StoreTime;
  orderCount: number;
  revenueCents: number;
}

/** Pure: merge grouped rows onto normalized wall-clock slots (16:00 and 16:00:00 are one slot). */
export function aggregateSlots(
  rows: readonly { time: string; orderCount: number; revenueCents: number }[],
): SlotPoint[] {
  const byTime = new Map<StoreTime, SlotPoint>();
  for (const row of rows) {
    const time = normalizeTime(row.time);
    const existing = byTime.get(time) ?? { time, orderCount: 0, revenueCents: 0 };
    existing.orderCount += row.orderCount;
    existing.revenueCents += row.revenueCents;
    byTime.set(time, existing);
  }
  return [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time));
}

export interface DayPoint {
  date: StoreDate;
  revenueCents: number;
  orderCount: number;
}

export interface PeriodTotals {
  revenueCents: number;
  /** Gratuities, deliberately excluded from revenueCents and the averages. */
  tipsCents: number;
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
  previousFrom: StoreDate;
  previousTo: StoreDate;
  days: number;
  /** Set when the window came from a preset link. */
  preset?: RangeDays;
  currency: string;
  current: PeriodTotals;
  /** The equal-length window immediately before this one, for the deltas. */
  previous: PeriodTotals;
  byDay: DayPoint[];
  /** Previous window aligned by index with `byDay`, for chart comparison. */
  previousByDay: DayPoint[];
  topItems: TopItem[];
  byWeekday: WeekdayPoint[];
  bySlot: SlotPoint[];
  /** Completed refunds whose money moved inside the window (by refund date, not pickup date). */
  refunds: { refundedCents: number; refundCount: number };
  upcoming: { revenueCents: number; orderCount: number };
  direct: {
    /** Direct pickup gross revenue in the selected window. */
    retainedRevenueCents: number;
    /** What this same direct revenue would have cost at the stated marketplace rate. */
    estimatedMarketplaceFeesCents: number;
    memberOrderCount: number;
    repeatMemberOrderCount: number;
    pointsEarned: number;
    rewardsRedeemed: number;
  };
}

/** Postgres returns sums and counts as strings; everything downstream wants numbers. */
const toNumber = (value: string | number | null): number => Number(value ?? 0);

export async function getSalesAnalytics(
  window: AnalyticsWindow,
  locationId?: string,
): Promise<SalesAnalytics> {
  const timeZone = serverEnv().STORE_TIMEZONE;
  const today = storeToday(new Date(), timeZone);
  const { from, to } = window;
  const days = daysBetween(from, to) + 1;
  const previousTo = addCalendarDays(from, -1);
  const previousFrom = addCalendarDays(previousTo, -(days - 1));

  // Refunds are bucketed by when the money moved, not by pickup date — a
  // Tuesday refund of a Saturday order belongs to Tuesday's numbers. Single
  // store-timezone day bounds are a deliberate simplification here (the
  // accounting export does the per-location version precisely).
  const refundsFrom = fromZonedTime(`${from}T00:00:00`, timeZone);
  const refundsUntil = fromZonedTime(`${addCalendarDays(to, 1)}T00:00:00`, timeZone);

  // One grouped query spans both windows: the previous period is just a
  // different slice of the same rows, so there's no reason to ask twice.
  const [revenueRows, canceledRows, topItemRows, upcomingRows, memberOrderRows, slotRows, refundRows] = await Promise.all([
    db()
      .select({
        date: orders.pickupDate,
        revenueCents: sql<string>`coalesce(sum(${orders.totalCents}), 0)`,
        tipsCents: sql<string>`coalesce(sum(${orders.tipCents}), 0)`,
        orderCount: sql<string>`count(*)`,
        currency: sql<string>`min(${orders.currency})`,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.status, [...REVENUE_STATUSES]),
          gte(orders.pickupDate, previousFrom),
          lte(orders.pickupDate, to),
          locationId ? eq(orders.squareLocationId, locationId) : undefined,
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
          locationId ? eq(orders.squareLocationId, locationId) : undefined,
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
          locationId ? eq(orders.squareLocationId, locationId) : undefined,
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
          locationId ? eq(orders.squareLocationId, locationId) : undefined,
        ),
      ),

    // Account-linked orders show whether the direct channel is becoming a
    // repeat relationship, not merely a one-time pickup form.
    db()
      .select({ customerAccountId: orders.customerAccountId, orderCount: sql<string>`count(*)` })
      .from(orders)
      .where(and(
        inArray(orders.status, [...REVENUE_STATUSES]),
        isNotNull(orders.customerAccountId),
        gte(orders.pickupDate, from),
        lte(orders.pickupDate, to),
        locationId ? eq(orders.squareLocationId, locationId) : undefined,
      ))
      .groupBy(orders.customerAccountId),

    // Which pickup slots actually carry the demand — the owner's input for
    // opening, closing, or re-capping times.
    db()
      .select({
        time: orders.pickupTime,
        orderCount: sql<string>`count(*)`,
        revenueCents: sql<string>`coalesce(sum(${orders.totalCents}), 0)`,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.status, [...REVENUE_STATUSES]),
          gte(orders.pickupDate, from),
          lte(orders.pickupDate, to),
          locationId ? eq(orders.squareLocationId, locationId) : undefined,
        ),
      )
      .groupBy(orders.pickupTime),

    db()
      .select({
        refundedCents: sql<string>`coalesce(sum(${orderRefunds.amountCents}), 0)`,
        refundCount: sql<string>`count(*)`,
      })
      .from(orderRefunds)
      .innerJoin(orders, eq(orderRefunds.orderId, orders.id))
      .where(
        and(
          eq(orderRefunds.status, "completed"),
          isNotNull(orderRefunds.completedAt),
          gte(orderRefunds.completedAt, refundsFrom),
          lt(orderRefunds.completedAt, refundsUntil),
          locationId ? eq(orders.squareLocationId, locationId) : undefined,
        ),
      ),
  ]);

  const accountIds = memberOrderRows.flatMap((row) => row.customerAccountId ? [row.customerAccountId] : []);
  const [memberHistoryRows, loyaltyRows] = await Promise.all([
    accountIds.length
      ? db().select({ customerAccountId: orders.customerAccountId, orderCount: sql<string>`count(*)` })
        .from(orders)
        .where(and(
          inArray(orders.status, [...REVENUE_STATUSES]),
          inArray(orders.customerAccountId, accountIds),
          lte(orders.pickupDate, to),
        ))
        .groupBy(orders.customerAccountId)
      : Promise.resolve([]),
    db().select({ kind: loyaltyEntries.kind, points: sql<string>`coalesce(sum(${loyaltyEntries.points}), 0)`, count: sql<string>`count(*)` })
      .from(loyaltyEntries)
      .innerJoin(orders, eq(loyaltyEntries.orderId, orders.id))
      .where(and(
        inArray(orders.status, [...REVENUE_STATUSES]),
        gte(orders.pickupDate, from),
        lte(orders.pickupDate, to),
        locationId ? eq(orders.squareLocationId, locationId) : undefined,
      ))
      .groupBy(loyaltyEntries.kind),
  ]);

  const revenueByDate = new Map(revenueRows.map((r) => [r.date, r]));
  const canceledByDate = new Map(canceledRows.map((r) => [r.date, toNumber(r.count)]));

  const totalsFor = (start: StoreDate, end: StoreDate): PeriodTotals => {
    let revenueCents = 0;
    let tipsCents = 0;
    let orderCount = 0;
    let canceledCount = 0;

    for (const [date, row] of revenueByDate) {
      if (date < start || date > end) continue;
      revenueCents += toNumber(row.revenueCents);
      tipsCents += toNumber(row.tipsCents);
      orderCount += toNumber(row.orderCount);
    }
    for (const [date, count] of canceledByDate) {
      if (date < start || date > end) continue;
      canceledCount += count;
    }

    return {
      revenueCents,
      tipsCents,
      orderCount,
      avgOrderCents: orderCount === 0 ? 0 : Math.round(revenueCents / orderCount),
      canceledCount,
    };
  };

  const historyByAccount = new Map(memberHistoryRows.map((row) => [row.customerAccountId, toNumber(row.orderCount)]));
  const loyaltyByKind = new Map(loyaltyRows.map((row) => [row.kind, row]));
  const memberOrderCount = memberOrderRows.reduce((total, row) => total + toNumber(row.orderCount), 0);
  const repeatMemberOrderCount = memberOrderRows.reduce((total, row) =>
    total + ((historyByAccount.get(row.customerAccountId) ?? 0) > 1 ? toNumber(row.orderCount) : 0), 0);

  // Every day in the window, including the empty ones — a chart that silently
  // drops zero-revenue days misreads as "we were busy all week".
  const byDay: DayPoint[] = [];
  const previousByDay: DayPoint[] = [];
  for (let i = 0; i < days; i++) {
    const date = addCalendarDays(from, i);
    const row = revenueByDate.get(date);
    byDay.push({
      date,
      revenueCents: toNumber(row?.revenueCents ?? 0),
      orderCount: toNumber(row?.orderCount ?? 0),
    });

    const previousDate = addCalendarDays(previousFrom, i);
    const previousRow = revenueByDate.get(previousDate);
    previousByDay.push({
      date: previousDate,
      revenueCents: toNumber(previousRow?.revenueCents ?? 0),
      orderCount: toNumber(previousRow?.orderCount ?? 0),
    });
  }

  return {
    today,
    from,
    to,
    previousFrom,
    previousTo,
    days,
    preset: window.preset,
    currency: revenueRows.find((r) => r.currency)?.currency ?? "USD",
    current: totalsFor(from, to),
    previous: totalsFor(previousFrom, previousTo),
    byDay,
    previousByDay,
    topItems: topItemRows.map((r) => ({
      name: r.name,
      quantity: toNumber(r.quantity),
      revenueCents: toNumber(r.revenueCents),
    })),
    byWeekday: aggregateByWeekday(byDay),
    bySlot: aggregateSlots(
      slotRows.map((row) => ({
        time: row.time,
        orderCount: toNumber(row.orderCount),
        revenueCents: toNumber(row.revenueCents),
      })),
    ),
    refunds: {
      refundedCents: toNumber(refundRows[0]?.refundedCents ?? 0),
      refundCount: toNumber(refundRows[0]?.refundCount ?? 0),
    },
    upcoming: {
      revenueCents: toNumber(upcomingRows[0]?.revenueCents ?? 0),
      orderCount: toNumber(upcomingRows[0]?.orderCount ?? 0),
    },
    direct: {
      retainedRevenueCents: totalsFor(from, to).revenueCents,
      estimatedMarketplaceFeesCents: Math.round(totalsFor(from, to).revenueCents * MARKETPLACE_FEE_RATE),
      memberOrderCount,
      repeatMemberOrderCount,
      pointsEarned: toNumber(loyaltyByKind.get("earned")?.points ?? 0),
      rewardsRedeemed: toNumber(loyaltyByKind.get("redeemed")?.count ?? 0),
    },
  };
}
