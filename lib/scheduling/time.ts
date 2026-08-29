import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * Store-local time primitives.
 *
 * Pickup dates and times are WALL-CLOCK AT THE STORE. "Pick up at 4 PM on
 * March 8th" means 4 PM in the shop, on that calendar day, regardless of what
 * the customer's device thinks and regardless of whether the clocks changed
 * that morning. Representing them as instants is how scheduling systems break
 * twice a year, so they stay as plain strings until the last moment.
 *
 * The only place an instant is needed is Square's `pickup_at`, which is RFC3339
 * — see pickupInstant().
 */

/** Calendar date at the store, `YYYY-MM-DD`. */
export type StoreDate = string;
/** Wall-clock time at the store, 24h `HH:mm`. */
export type StoreTime = string;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

export function isStoreDate(value: string): value is StoreDate {
  return DATE_PATTERN.test(value);
}

export function assertStoreDate(value: string): StoreDate {
  if (!isStoreDate(value)) {
    throw new Error(`Expected a YYYY-MM-DD store date, got "${value}"`);
  }
  return value;
}

/**
 * Normalise a time to `HH:mm`.
 *
 * Postgres `time` columns come back as `HH:MM:SS`, while config and UI use
 * `HH:mm`. Everything downstream compares times as strings, which is only
 * correct if they're all the same shape — so normalise at every boundary.
 */
export function normalizeTime(value: string): StoreTime {
  const match = TIME_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Expected a HH:mm or HH:mm:ss time, got "${value}"`);
  }
  return `${match[1]}:${match[2]}`;
}

/** The calendar date it currently is at the store. */
export function storeToday(now: Date, timeZone: string): StoreDate {
  return formatInTimeZone(now, timeZone, "yyyy-MM-dd");
}

/** The wall-clock time it currently is at the store. */
export function storeNowTime(now: Date, timeZone: string): StoreTime {
  return formatInTimeZone(now, timeZone, "HH:mm");
}

/**
 * Add whole calendar days to a date.
 *
 * Done in UTC deliberately. Adding 24 hours to a local Date is wrong across a
 * DST boundary — on a spring-forward day it lands on the same calendar date,
 * and on fall-back it can land two days out. UTC has no DST, so incrementing
 * the UTC day is exact calendar arithmetic.
 */
export function addCalendarDays(date: StoreDate, days: number): StoreDate {
  assertStoreDate(date);
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to`; negative if `to` is earlier. */
export function daysBetween(from: StoreDate, to: StoreDate): number {
  const parse = (d: StoreDate) => {
    const [y, m, day] = assertStoreDate(d).split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/** ISO dates and zero-padded 24h times both sort correctly as plain strings. */
export const compareDates = (a: StoreDate, b: StoreDate): number => a.localeCompare(b);
export const compareTimes = (a: StoreTime, b: StoreTime): number => a.localeCompare(b);

/**
 * Add minutes to a store-local wall-clock time.
 *
 * Returns null when the result crosses midnight rather than wrapping. Wrapping
 * would turn "20 minutes after 23:50" into 00:10 *today* — a time that already
 * passed — which is exactly the class of bug this helper exists to prevent.
 */
export function addMinutesToTime(time: StoreTime, minutes: number): StoreTime | null {
  const [hours, mins] = normalizeTime(time).split(":");
  const total = Number(hours) * 60 + Number(mins) + minutes;
  if (!Number.isFinite(total) || total < 0 || total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Convert a store-local date + time into a real instant, for Square's
 * `pickup_at` field. This is the one direction where DST genuinely matters, and
 * date-fns-tz resolves it against the zone's rules.
 */
export function pickupInstant(
  date: StoreDate,
  time: StoreTime,
  timeZone: string,
): Date {
  return fromZonedTime(`${assertStoreDate(date)}T${normalizeTime(time)}:00`, timeZone);
}

export type DateStyle = "short" | "medium" | "long";

const DATE_STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { month: "short", day: "numeric" },
  medium: { weekday: "short", month: "short", day: "numeric" },
  long: { weekday: "long", month: "long", day: "numeric" },
};

/**
 * Render a store date for humans, e.g. "Thursday, March 5".
 *
 * Formatted in UTC deliberately. A store date is a bare calendar day; handing it
 * to a formatter in the viewer's own timezone can render the day before, which
 * is how a customer ends up being told the wrong pickup date.
 */
export function formatStoreDate(date: StoreDate, style: DateStyle = "long"): string {
  const [year, month, day] = assertStoreDate(date).split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Intl.DateTimeFormat("en-US", {
    ...DATE_STYLES[style],
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** Render a pickup time for humans, e.g. "4:00 PM". */
export function formatPickupTime(time: StoreTime): string {
  const [hourText, minute] = normalizeTime(time).split(":") as [string, string];
  const hour = Number(hourText);
  const suffix = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${minute} ${suffix}`;
}

/**
 * How long ago something happened, in words.
 *
 * Rendered on the server so the string is stable between server and client —
 * computing it in the browser would be a hydration mismatch, and "now" differs
 * between the two by however long the response took.
 *
 * Coarse on purpose. The staff device list is answering "is this tablet still
 * in use?", and to that question "3 hours ago" and "3 hours and 12 minutes ago"
 * are the same answer.
 */
export function relativeTime(then: Date, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  /* Negative too: clock skew between the database and the web server can put a
     just-written timestamp slightly in the future, and "in -3 seconds" is worse
     than a rounding lie. */
  if (seconds < 90) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return days === 1 ? "yesterday" : `${days} days ago`;

  const months = Math.round(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
}
