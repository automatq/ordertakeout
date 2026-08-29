import {
  addCalendarDays,
  addMinutesToTime,
  compareDates,
  compareTimes,
  normalizeTime,
  storeNowTime,
  storeToday,
  type StoreDate,
  type StoreTime,
} from "./time";

/**
 * The pickup scheduling engine.
 *
 * This is the piece the client's questions 7, 8 and 9 actually live in: can the
 * customer choose a pickup time, can we block Ensaymada after the 6 PM cutoff,
 * and can we stop a slot being overbooked.
 *
 * It is deliberately PURE — every input (blackout dates, how full each slot
 * already is, the current instant) is passed in rather than fetched. That makes
 * cutoff boundaries and DST transitions testable without a database or a clock,
 * and it means the storefront UI and the server-side checkout guard can run
 * exactly the same code. They must: the UI greys out invalid slots for UX, but
 * a customer who leaves the page open past 6 PM has to be stopped at checkout,
 * and two implementations of these rules would inevitably drift apart.
 */

export interface ProductRule {
  productId: string;
  /** Minimum whole days between ordering and pickup. Ensaymada = 1. */
  leadTimeDays: number;
  /** Daily order deadline, store-local. Ensaymada = "18:00". */
  orderCutoffTime: StoreTime;
  /** The pickup times this product is offered at. Ensaymada = 16:00–20:00 hourly. */
  allowedPickupTimes: readonly StoreTime[];
  /** Units of this product that can be produced in one day. Null = unlimited. */
  maxUnitsPerDay: number | null;
  isOrderable: boolean;
  /**
   * Minutes the kitchen needs before this item can be collected, for same-day
   * ordering ("ready in 20 minutes"). Optional so existing callers read as
   * before; absent means it can be collected at the next offered time.
   */
  minimumPrepMinutes?: number;
}

export interface CartLine {
  productId: string;
  quantity: number;
}

export interface AvailabilityInput {
  /** The current instant. Injected so tests can pin it. */
  now: Date;
  timeZone: string;
  cart: readonly CartLine[];
  rules: readonly ProductRule[];
  /** How far ahead bookings are accepted, counted from today. */
  horizonDays: number;
  blackoutDates: ReadonlySet<StoreDate>;
  /**
   * `${productId}|${date}` staff "sold out today" 86 entries. Optional so the
   * engine's many existing callers/tests read as before; absent means none.
   */
  productDateBlocks?: ReadonlySet<string>;
  /** `${date}|${time}` → orders already committed (paid orders + live holds). */
  slotUsage: ReadonlyMap<string, number>;
  /** `${date}|${time}` → staff override for that slot's order cap. */
  slotCapacityOverrides: ReadonlyMap<string, number>;
  defaultSlotCapacity: number;
  /** `${productId}|${date}` → units of that product already committed that day. */
  productDayUsage: ReadonlyMap<string, number>;
}

export type SlotUnavailableReason =
  | "blackout"
  | "slot_full"
  | "product_daily_capacity"
  | "product_sold_out"
  /** Same-day only: this time is already in the past, or inside the prep window. */
  | "time_passed";

export interface SlotAvailability {
  time: StoreTime;
  available: boolean;
  reason?: SlotUnavailableReason;
  /** Orders still accepted in this slot. Omitted when unavailable for another reason. */
  remainingOrders?: number;
}

export interface DayAvailability {
  date: StoreDate;
  slots: SlotAvailability[];
  hasAvailability: boolean;
}

export type CartProblem =
  | { kind: "empty_cart" }
  | { kind: "unknown_product"; productId: string }
  | { kind: "product_unavailable"; productId: string }
  | { kind: "invalid_quantity"; productId: string }
  /** Cart mixes products whose pickup windows don't overlap — must be split. */
  | { kind: "no_common_pickup_time"; productIds: string[] };

export type AvailabilityResult =
  | {
      ok: true;
      /** Earliest date satisfying every lead time and cutoff in the cart. */
      earliestDate: StoreDate;
      /** Pickup times common to every product in the cart, ascending. */
      offeredTimes: StoreTime[];
      days: DayAvailability[];
    }
  | { ok: false; problem: CartProblem };

export const slotKey = (date: StoreDate, time: StoreTime): string =>
  `${date}|${normalizeTime(time)}`;

export const productDayKey = (productId: string, date: StoreDate): string =>
  `${productId}|${date}`;

/**
 * Earliest pickup date for a single product.
 *
 * The client's rule reads: "Orders must be placed one day in advance, before
 * 6:00 PM. Pickup starts at 4:00 PM the following day." So ordering at 3 PM
 * Monday allows Tuesday pickup; ordering at 7 PM Monday pushes to Wednesday.
 *
 * The comparison is `>=` because "before 6:00 PM" excludes 6:00 PM exactly.
 */
export function earliestPickupDate(
  rule: ProductRule,
  today: StoreDate,
  nowTime: StoreTime,
): StoreDate {
  const pastCutoff = compareTimes(nowTime, normalizeTime(rule.orderCutoffTime)) >= 0;
  return addCalendarDays(today, rule.leadTimeDays + (pastCutoff ? 1 : 0));
}

export function computeAvailability(input: AvailabilityInput): AvailabilityResult {
  const {
    now,
    timeZone,
    cart,
    rules,
    horizonDays,
    blackoutDates,
    productDateBlocks,
    slotUsage,
    slotCapacityOverrides,
    defaultSlotCapacity,
    productDayUsage,
  } = input;

  if (cart.length === 0) {
    return { ok: false, problem: { kind: "empty_cart" } };
  }

  const rulesById = new Map(rules.map((r) => [r.productId, r]));
  const cartRules: { line: CartLine; rule: ProductRule }[] = [];

  for (const line of cart) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      return { ok: false, problem: { kind: "invalid_quantity", productId: line.productId } };
    }
    const rule = rulesById.get(line.productId);
    if (!rule) {
      return { ok: false, problem: { kind: "unknown_product", productId: line.productId } };
    }
    if (!rule.isOrderable) {
      return { ok: false, problem: { kind: "product_unavailable", productId: line.productId } };
    }
    cartRules.push({ line, rule });
  }

  const today = storeToday(now, timeZone);
  const nowTime = storeNowTime(now, timeZone);

  // A mixed cart is gated by its slowest item — take the latest of the
  // per-product earliest dates, not the earliest.
  let earliestDate = today;
  for (const { rule } of cartRules) {
    const candidate = earliestPickupDate(rule, today, nowTime);
    if (compareDates(candidate, earliestDate) > 0) earliestDate = candidate;
  }

  // Only times every product is offered at. An empty intersection is surfaced
  // as an explicit problem rather than an empty calendar, so the customer is
  // told to split the order instead of staring at a screen with no slots.
  const offeredTimes = intersectPickupTimes(cartRules.map(({ rule }) => rule));
  if (offeredTimes.length === 0) {
    return {
      ok: false,
      problem: {
        kind: "no_common_pickup_time",
        productIds: cartRules.map(({ rule }) => rule.productId),
      },
    };
  }

  /* The slowest item gates same-day collection, mirroring how earliestDate
     takes the max of the per-product lead times. Null means the prep window
     runs past midnight, so nothing is collectable today at all. */
  const prepMinutes = Math.max(0, ...cartRules.map(({ rule }) => rule.minimumPrepMinutes ?? 0));
  const earliestTimeToday = addMinutesToTime(nowTime, prepMinutes);

  const lastDate = addCalendarDays(today, horizonDays);
  const days: DayAvailability[] = [];

  for (
    let date = earliestDate;
    compareDates(date, lastDate) <= 0;
    date = addCalendarDays(date, 1)
  ) {
    days.push(buildDay(date, offeredTimes, cartRules, {
      today,
      earliestTimeToday,
      blackoutDates,
      productDateBlocks,
      slotUsage,
      slotCapacityOverrides,
      defaultSlotCapacity,
      productDayUsage,
    }));
  }

  return { ok: true, earliestDate, offeredTimes, days };
}

type CapacityContext = Pick<
  AvailabilityInput,
  | "blackoutDates"
  | "productDateBlocks"
  | "slotUsage"
  | "slotCapacityOverrides"
  | "defaultSlotCapacity"
  | "productDayUsage"
> & {
  today: StoreDate;
  /** Earliest collectable time today (now + prep). Null once prep passes midnight. */
  earliestTimeToday: StoreTime | null;
};

function buildDay(
  date: StoreDate,
  offeredTimes: readonly StoreTime[],
  cartRules: readonly { line: CartLine; rule: ProductRule }[],
  ctx: CapacityContext,
): DayAvailability {
  if (ctx.blackoutDates.has(date)) {
    return {
      date,
      slots: offeredTimes.map((time) => ({ time, available: false, reason: "blackout" })),
      hasAvailability: false,
    };
  }

  // A staff 86 gates the whole day for that product, exactly like a blackout
  // but scoped to one item.
  if (cartRules.some(({ rule }) => ctx.productDateBlocks?.has(productDayKey(rule.productId, date)))) {
    return {
      date,
      slots: offeredTimes.map((time) => ({ time, available: false, reason: "product_sold_out" })),
      hasAvailability: false,
    };
  }

  // Production caps are per DAY, so they gate every slot on that day equally.
  const dailyCapacityExceeded = cartRules.some(({ line, rule }) => {
    if (rule.maxUnitsPerDay === null) return false;
    const used = ctx.productDayUsage.get(productDayKey(rule.productId, date)) ?? 0;
    return used + line.quantity > rule.maxUnitsPerDay;
  });

  if (dailyCapacityExceeded) {
    return {
      date,
      slots: offeredTimes.map((time) => ({
        time,
        available: false,
        reason: "product_daily_capacity",
      })),
      hasAvailability: false,
    };
  }

  const slots = offeredTimes.map((time): SlotAvailability => {
    /* A time that has already passed must never be offered. This was invisible
       while every product had leadTimeDays >= 1, because that guarantees each
       offered date is in the future — but at lead time 0 the engine happily
       offered this morning's slots at 3 PM, and validatePickupSelection ran the
       same code so the server accepted them too. */
    if (
      date === ctx.today &&
      (ctx.earliestTimeToday === null || compareTimes(time, ctx.earliestTimeToday) < 0)
    ) {
      return { time, available: false, reason: "time_passed" };
    }

    const key = slotKey(date, time);
    const capacity = ctx.slotCapacityOverrides.get(key) ?? ctx.defaultSlotCapacity;
    const used = ctx.slotUsage.get(key) ?? 0;
    const remainingOrders = Math.max(0, capacity - used);

    return remainingOrders > 0
      ? { time, available: true, remainingOrders }
      : { time, available: false, reason: "slot_full", remainingOrders: 0 };
  });

  return { date, slots, hasAvailability: slots.some((s) => s.available) };
}

function intersectPickupTimes(rules: readonly ProductRule[]): StoreTime[] {
  const [first, ...rest] = rules;
  if (!first) return [];

  let common = new Set(first.allowedPickupTimes.map(normalizeTime));
  for (const rule of rest) {
    const times = new Set(rule.allowedPickupTimes.map(normalizeTime));
    common = new Set([...common].filter((t) => times.has(t)));
    if (common.size === 0) break;
  }
  return [...common].sort(compareTimes);
}

export type SelectionRejection =
  | { kind: "cart_problem"; problem: CartProblem }
  | { kind: "before_earliest_date"; earliestDate: StoreDate }
  | { kind: "beyond_horizon" }
  | { kind: "time_not_offered"; offeredTimes: StoreTime[] }
  | { kind: "slot_unavailable"; reason: SlotUnavailableReason };

/**
 * Authoritative check for a specific pickup selection, run server-side at
 * checkout immediately before payment.
 *
 * Built on computeAvailability rather than re-deriving the rules, so the guard
 * can never disagree with the calendar the customer was shown.
 */
export function validatePickupSelection(
  input: AvailabilityInput,
  selection: { date: StoreDate; time: StoreTime },
): { ok: true } | { ok: false; rejection: SelectionRejection } {
  const availability = computeAvailability(input);
  if (!availability.ok) {
    return { ok: false, rejection: { kind: "cart_problem", problem: availability.problem } };
  }

  const time = normalizeTime(selection.time);

  if (compareDates(selection.date, availability.earliestDate) < 0) {
    return {
      ok: false,
      rejection: { kind: "before_earliest_date", earliestDate: availability.earliestDate },
    };
  }

  if (!availability.offeredTimes.includes(time)) {
    return {
      ok: false,
      rejection: { kind: "time_not_offered", offeredTimes: availability.offeredTimes },
    };
  }

  const day = availability.days.find((d) => d.date === selection.date);
  if (!day) {
    return { ok: false, rejection: { kind: "beyond_horizon" } };
  }

  const slot = day.slots.find((s) => s.time === time);
  if (!slot || !slot.available) {
    return {
      ok: false,
      rejection: { kind: "slot_unavailable", reason: slot?.reason ?? "slot_full" },
    };
  }

  return { ok: true };
}
