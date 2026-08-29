/**
 * Does this JS engine know what time it is in Toronto?
 *
 * Every pickup date, cutoff and lead time in Harina is computed from
 * `Intl.DateTimeFormat` with an explicit `timeZone` — see lib/scheduling/time.ts
 * in the web app, where `storeToday` is `formatInTimeZone(now, tz, "yyyy-MM-dd")`
 * and nothing else. On V8 that is exact. Hermes builds its `Intl` on the
 * platform's own libraries (Android ICU, Apple Foundation), and a build without
 * full tz data silently answers in UTC instead of throwing.
 *
 * Silently is the problem. A store in Toronto asking for "today" between 19:00
 * and 23:59 local gets tomorrow's date back, so the ordering cutoff moves a day
 * and customers are told to collect on a day the bakery is closed. Nothing logs
 * an error; the arithmetic is simply wrong after 7pm.
 *
 * This file imports nothing from React Native on purpose, so the same assertions
 * run under Node (where they must all pass — that is how the fixtures were
 * verified) and on the device.
 */

import { formatInTimeZone } from "date-fns-tz";

export interface CheckResult {
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
  /** What a failure would actually cost, so a red row is self-explaining. */
  consequence?: string;
}

const TORONTO = "America/Toronto";
/* UTC+12:45, and it observes DST. The web test suite runs pinned to this zone
   for the same reason: a 45-minute offset breaks any implementation that
   secretly rounds to whole hours. */
const CHATHAM = "Pacific/Chatham";

function parts(iso: string, timeZone: string): string {
  const map = new Map(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value] as const),
  );
  return `${map.get("year")}-${map.get("month")}-${map.get("day")} ${map.get("hour")}:${map.get("minute")}`;
}

function check(
  name: string,
  expected: string,
  produce: () => string,
  consequence?: string,
): CheckResult {
  let actual: string;
  try {
    actual = produce();
  } catch (cause) {
    actual = `threw: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
  return { name, expected, actual, pass: actual === expected, consequence };
}

export function runIntlChecks(): CheckResult[] {
  return [
    check("Intl.DateTimeFormat exists", "function", () => typeof Intl?.DateTimeFormat),

    check(
      "honours the timeZone option at all",
      "true",
      () =>
        String(
          new Intl.DateTimeFormat("en-US", { timeZone: TORONTO }).resolvedOptions().timeZone ===
            TORONTO,
        ),
      "An engine that reports UTC here ignores the option entirely — every date is the server's, not the store's.",
    ),

    /* Winter and summer, so a fixed-offset implementation fails one of them. */
    check("Toronto in January (EST, UTC-5)", "2026-01-15 12:30", () =>
      parts("2026-01-15T17:30:00Z", TORONTO),
    ),
    check("Toronto in July (EDT, UTC-4)", "2026-07-15 13:30", () =>
      parts("2026-07-15T17:30:00Z", TORONTO),
    ),

    check(
      "late evening in Toronto is still yesterday in UTC",
      "2026-01-14 23:30",
      () => parts("2026-01-15T04:30:00Z", TORONTO),
      "This is the bug in its natural habitat: 11:30pm Wednesday at the shop, already Thursday in UTC. Fall back to UTC and the cutoff jumps a day every evening.",
    ),

    /* Spring forward: 01:59 EST is followed one minute later by 03:00 EDT. */
    check("the instant before spring-forward", "2026-03-08 01:59", () =>
      parts("2026-03-08T06:59:00Z", TORONTO),
    ),
    check(
      "the instant after spring-forward",
      "2026-03-08 03:00",
      () => parts("2026-03-08T07:00:00Z", TORONTO),
      "Stale tz data usually shows 02:00 here — the hour that does not exist.",
    ),

    /* Fall back: the same wall clock happens twice, an hour apart. */
    check("1:30am on fall-back day, first pass (EDT)", "2026-11-01 01:30", () =>
      parts("2026-11-01T05:30:00Z", TORONTO),
    ),
    check(
      "1:30am on fall-back day, second pass (EST)",
      "2026-11-01 01:30",
      () => parts("2026-11-01T06:30:00Z", TORONTO),
      "Two different instants, one wall clock. Only a real tz database gets both.",
    ),

    check(
      "a 45-minute offset survives",
      "2026-01-16 07:15",
      () => parts("2026-01-15T17:30:00Z", CHATHAM),
      "Chatham is UTC+12:45. Anything that rounds to whole hours lands on :30 or :00.",
    ),

    /* The library the app actually calls, not just the primitive under it. */
    check(
      "date-fns-tz agrees (this is what storeToday calls)",
      "2026-01-14",
      () => formatInTimeZone(new Date("2026-01-15T04:30:00Z"), TORONTO, "yyyy-MM-dd"),
      "storeToday is exactly this call. If it disagrees, every cutoff in the app is wrong.",
    ),
    check("date-fns-tz wall clock", "23:30", () =>
      formatInTimeZone(new Date("2026-01-15T04:30:00Z"), TORONTO, "HH:mm"),
    ),
  ];
}
