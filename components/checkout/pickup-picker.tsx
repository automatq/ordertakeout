"use client";

import { useMemo, useRef, useState } from "react";

import type { DayAvailability, SlotUnavailableReason } from "@/lib/scheduling/availability";
import { formatPickupTime, formatStoreDate } from "@/lib/scheduling/time";

/**
 * Pickup date and time selection.
 *
 * Unavailable slots are shown disabled with a reason rather than hidden. "Sold
 * out" tells the customer to try another time; a silently missing slot just
 * looks like the site is broken.
 *
 * Three things this version fixes:
 *
 *  1. Nothing is pre-selected. The old picker fell back to `selectableDays[0]`
 *     when there was no value, so the first date rendered brand-filled — the UI
 *     claimed a date was chosen while the form still had none and Continue was
 *     disabled. Which day's times to *show* and which day is *chosen* are now
 *     separate pieces of state.
 *
 *  2. It's a real radiogroup. It used to be 21 independent toggle buttons, so
 *     assistive tech announced no grouping and arrow keys did nothing. Roving
 *     tabindex means the whole rail is one tab stop with arrow navigation.
 *
 *  3. Choosing a date still auto-selects the earliest open time — but says so
 *     in the live region instead of changing the booking silently.
 */

const REASON_LABEL: Record<SlotUnavailableReason, string> = {
  blackout: "Closed",
  slot_full: "Fully booked",
  product_daily_capacity: "Sold out",
  product_sold_out: "Sold out for this day",
  time_passed: "Too late today",
};

export interface PickupSelection {
  date: string;
  time: string;
}

/**
 * How many dates the rail offers. The booking horizon already limits pickup to
 * the next few days (see MAX_ORDER_HORIZON_DAYS), so this is a matching upper
 * bound rather than the real constraint. Beyond it, customers call the store.
 */
const MAX_DATES = 21;

export function PickupPicker({
  days,
  value,
  onChange,
}: {
  days: DayAvailability[];
  value: PickupSelection | null;
  onChange: (selection: PickupSelection) => void;
}) {
  const selectableDays = useMemo(
    () => days.filter((d) => d.hasAvailability).slice(0, MAX_DATES),
    [days],
  );

  /**
   * The day whose times are on screen. Distinct from `value`: on first render
   * we show the earliest available day's times so the customer can see what
   * they're choosing between, without claiming they've chosen that day.
   */
  const [browsingDate, setBrowsingDate] = useState<string | null>(null);
  const activeDate = value?.date ?? browsingDate ?? selectableDays[0]?.date ?? null;
  const activeDay = days.find((d) => d.date === activeDate) ?? null;

  const [announcement, setAnnouncement] = useState("");
  const dateRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const timeRefs = useRef<(HTMLButtonElement | null)[]>([]);

  if (selectableDays.length === 0) {
    return (
      <p role="status" className="panel text-ink-muted p-4 text-sm">
        No pickup times are available for this order right now. Please call the store.
      </p>
    );
  }

  function selectDate(day: DayAvailability) {
    setBrowsingDate(day.date);

    const firstOpen = day.slots.find((s) => s.available);
    if (!firstOpen) {
      // Can't happen for a day in `selectableDays`, but the rail is driven by
      // `hasAvailability` and the slots by `available`, so don't assume.
      setAnnouncement(`${formatStoreDate(day.date, "long")} has no open pickup times.`);
      return;
    }

    onChange({ date: day.date, time: firstOpen.time });
    setAnnouncement(
      `Pickup set to ${formatStoreDate(day.date, "long")} at ${formatPickupTime(
        firstOpen.time,
      )}. Choose a different time below if you'd prefer.`,
    );
  }

  /** Arrow-key navigation across the date rail, per the radiogroup pattern. */
  function handleDateKeyDown(event: React.KeyboardEvent, index: number) {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : event.key === "Home"
            ? -index
            : event.key === "End"
              ? selectableDays.length - 1 - index
              : 0;

    if (delta === 0) return;
    event.preventDefault();

    const next = Math.min(Math.max(index + delta, 0), selectableDays.length - 1);
    const day = selectableDays[next];
    if (!day) return;

    dateRefs.current[next]?.focus();
    selectDate(day);
  }

  function selectTime(day: DayAvailability, time: string) {
    onChange({ date: day.date, time });
    setAnnouncement(
      `Pickup set to ${formatStoreDate(day.date, "long")} at ${formatPickupTime(time)}.`,
    );
  }

  /** One tab stop and arrow-key movement for the time radiogroup as well. */
  function handleTimeKeyDown(
    event: React.KeyboardEvent,
    day: DayAvailability,
    slotIndex: number,
  ) {
    const availableIndexes = day.slots.flatMap((slot, index) =>
      slot.available ? [index] : [],
    );
    const position = availableIndexes.indexOf(slotIndex);
    if (position < 0) return;

    const nextPosition =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? Math.min(position + 1, availableIndexes.length - 1)
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? Math.max(position - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? availableIndexes.length - 1
              : position;

    if (nextPosition === position && !["Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = availableIndexes[nextPosition];
    if (nextIndex === undefined) return;
    const nextSlot = day.slots[nextIndex];
    if (!nextSlot) return;
    timeRefs.current[nextIndex]?.focus();
    selectTime(day, nextSlot.time);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h3
          id="pickup-date-label"
          className="text-ink-subtle text-sm font-semibold tracking-wide uppercase"
        >
          Pickup date
        </h3>

        {/* A rail rather than a wrapping block: keeps the dates on one line, in
            sequence, and scrolls gracefully if the window ever widens. */}
        <div role="radiogroup" aria-labelledby="pickup-date-label" className="scroll-row gap-2">
          {selectableDays.map((day, index) => {
            const chosen = value?.date === day.date;
            const browsing = !chosen && activeDate === day.date;
            const [weekday, monthDay] = splitDateLabel(day.date);

            return (
              <button
                key={day.date}
                ref={(node) => {
                  dateRefs.current[index] = node;
                }}
                type="button"
                role="radio"
                aria-checked={chosen}
                /* Roving tabindex: one stop for the whole rail. Focus lands on
                   the chosen day, or the first if nothing is chosen yet. */
                tabIndex={chosen || (!value && index === 0) ? 0 : -1}
                onClick={() => selectDate(day)}
                onKeyDown={(event) => handleDateKeyDown(event, index)}
                className={`rounded-card flex min-w-20 flex-col items-center gap-0.5 border-2 px-4 py-3 transition-colors ${
                  chosen
                    ? "border-brand bg-brand text-brand-ink shadow-brand"
                    : browsing
                      ? "border-border-strong bg-surface text-ink"
                      : "border-border bg-surface text-ink-muted hover:border-accent hover:bg-accent-soft"
                }`}
              >
                <span className="text-xs tracking-wide uppercase opacity-80">{weekday}</span>
                <span className="font-display text-xl leading-none font-normal">
                  {monthDay}
                </span>
                <span className="text-[0.7rem] opacity-70">{relativeLabel(day.date)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {activeDay ? (
        <div className="flex flex-col gap-3">
          <h3
            id="pickup-time-label"
            className="text-ink-subtle text-sm font-semibold tracking-wide uppercase"
          >
            Pickup time &mdash;{" "}
            <span className="text-ink normal-case">
              {formatStoreDate(activeDay.date, "long")}
            </span>
          </h3>

          <div
            role="radiogroup"
            aria-labelledby="pickup-time-label"
            className="flex flex-wrap gap-2"
          >
            {activeDay.slots.map((slot, index) => {
              const chosen = value?.date === activeDay.date && value.time === slot.time;
              const firstAvailable = activeDay.slots.findIndex((entry) => entry.available);
              return (
                <button
                  key={slot.time}
                  ref={(node) => {
                    timeRefs.current[index] = node;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  disabled={!slot.available}
                  tabIndex={chosen || (!value?.time && index === firstAvailable) ? 0 : -1}
                  onClick={() => selectTime(activeDay, slot.time)}
                  onKeyDown={(event) => handleTimeKeyDown(event, activeDay, index)}
                  className="chip flex flex-col items-start text-sm"
                >
                  <span>{formatPickupTime(slot.time)}</span>
                  {!slot.available && slot.reason ? (
                    <span className="chip-note text-xs font-normal">
                      {REASON_LABEL[slot.reason]}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Selection changes are announced here rather than being inferred from a
          chip flipping colour. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

/** "Fri" / "Mar 5", for the two lines of a date card. */
function splitDateLabel(date: string): [string, string] {
  const medium = formatStoreDate(date, "medium"); // e.g. "Fri, Mar 5"
  const [weekday, rest] = medium.split(", ");
  return [weekday ?? "", rest ?? medium];
}

/**
 * "Today" / "Tomorrow" where it applies.
 *
 * Computed against the browser's clock, which is a deliberate simplification:
 * this is a decorative hint next to an unambiguous date, and the store's own
 * timezone already governs every date in the list. Worst case a customer in
 * another timezone sees no hint, never a wrong date.
 */
function relativeLabel(date: string): string {
  const today = new Date();
  const local = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;

  if (date === local) return "Today";

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const localTomorrow = `${tomorrow.getFullYear()}-${String(
    tomorrow.getMonth() + 1,
  ).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

  return date === localTomorrow ? "Tomorrow" : " ";
}
