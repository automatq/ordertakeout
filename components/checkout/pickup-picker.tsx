"use client";

import { useMemo } from "react";

import type { DayAvailability, SlotUnavailableReason } from "@/lib/scheduling/availability";
import { formatPickupTime, formatStoreDate } from "@/lib/scheduling/time";

/**
 * Pickup date and time selection.
 *
 * Unavailable slots are shown disabled with a reason rather than hidden. "Sold
 * out" tells the customer to try another time; a silently missing slot just looks
 * like the site is broken.
 */

const REASON_LABEL: Record<SlotUnavailableReason, string> = {
  blackout: "Closed",
  slot_full: "Fully booked",
  product_daily_capacity: "Sold out",
};

export interface PickupSelection {
  date: string;
  time: string;
}

export function PickupPicker({
  days,
  value,
  onChange,
}: {
  days: DayAvailability[];
  value: PickupSelection | null;
  onChange: (selection: PickupSelection) => void;
}) {
  const selectableDays = useMemo(() => days.filter((d) => d.hasAvailability), [days]);
  const activeDate = value?.date ?? selectableDays[0]?.date ?? null;
  const activeDay = days.find((d) => d.date === activeDate) ?? null;

  if (selectableDays.length === 0) {
    return (
      <p role="status" className="text-ink-muted text-sm">
        No pickup times are available for this order right now. Please call the store.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-ink-subtle mb-2 text-sm font-semibold tracking-wide uppercase">
          Pickup date
        </legend>
        <div className="flex flex-wrap gap-2">
          {selectableDays.slice(0, 21).map((day) => {
            const selected = day.date === activeDate;
            return (
              <button
                key={day.date}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  const firstOpen = day.slots.find((s) => s.available);
                  if (firstOpen) onChange({ date: day.date, time: firstOpen.time });
                }}
                className={`rounded-control border px-3 py-2 text-sm transition-colors ${
                  selected
                    ? "border-brand bg-brand text-brand-ink font-semibold"
                    : "border-border bg-surface text-ink hover:border-border-strong"
                }`}
              >
                {formatStoreDate(day.date, "medium")}
              </button>
            );
          })}
        </div>
      </fieldset>

      {activeDay ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-ink-subtle mb-2 text-sm font-semibold tracking-wide uppercase">
            Pickup time
          </legend>
          <div className="flex flex-wrap gap-2">
            {activeDay.slots.map((slot) => {
              const selected = value?.date === activeDay.date && value.time === slot.time;
              const label = formatPickupTime(slot.time);
              return (
                <button
                  key={slot.time}
                  type="button"
                  disabled={!slot.available}
                  aria-pressed={selected}
                  onClick={() => onChange({ date: activeDay.date, time: slot.time })}
                  className={`rounded-control flex flex-col items-start border px-3 py-2 text-sm transition-colors ${
                    selected
                      ? "border-brand bg-brand text-brand-ink font-semibold"
                      : slot.available
                        ? "border-border bg-surface text-ink hover:border-border-strong"
                        : "border-border bg-surface-sunken text-ink-subtle cursor-not-allowed"
                  }`}
                >
                  <span>{label}</span>
                  {!slot.available && slot.reason ? (
                    <span className="text-xs font-normal">{REASON_LABEL[slot.reason]}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
