"use client";

import { useState, useTransition } from "react";

import {
  addBlackoutAction,
  clearSlotCapacityAction,
  removeBlackoutAction,
  resyncCatalogAction,
  setSlotCapacityAction,
  type AdminResult,
} from "@/app/actions/admin";
import { formatPickupTime, formatStoreDate } from "@/lib/scheduling/time";

/** Closure dates, per-slot caps, and the catalog re-sync button. */

export function BlackoutDates({
  dates,
}: {
  dates: { date: string; reason: string | null }[];
}) {
  const [result, setResult] = useState<AdminResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (action: (fd: FormData) => Promise<AdminResult>) => (formData: FormData) =>
    startTransition(async () => setResult(await action(formData)));

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-ink text-lg font-semibold">Closure dates</h2>
        <p className="text-ink-muted text-sm">
          No pickups are offered on these days. Holidays, deep cleans, staff days off.
        </p>
      </div>

      <form action={run(addBlackoutAction)} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-ink text-sm font-medium">Date</span>
          <input
            type="date"
            name="date"
            required
            className="rounded-control border-border bg-surface text-ink border px-3 py-2"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-ink text-sm font-medium">Reason (optional)</span>
          <input
            type="text"
            name="reason"
            placeholder="Christmas Day"
            className="rounded-control border-border bg-surface text-ink w-full border px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-control bg-brand text-brand-ink hover:bg-brand-hover px-4 py-2 font-semibold transition-colors disabled:opacity-50"
        >
          Add
        </button>
      </form>

      <Feedback result={result} />

      {dates.length === 0 ? (
        <p className="text-ink-muted text-sm">No upcoming closures.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {dates.map((entry) => (
            <li
              key={entry.date}
              className="rounded-control border-border bg-surface flex items-center justify-between border px-4 py-2"
            >
              <span className="text-ink">
                {formatStoreDate(entry.date)}
                {entry.reason ? (
                  <span className="text-ink-muted"> — {entry.reason}</span>
                ) : null}
              </span>
              <form action={run(removeBlackoutAction)}>
                <input type="hidden" name="date" value={entry.date} />
                <button
                  type="submit"
                  className="text-ink-subtle hover:text-danger text-sm underline transition-colors"
                >
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SlotCapacity({
  slots,
  defaultCap,
}: {
  slots: { pickupDate: string; pickupTime: string; maxOrders: number }[];
  defaultCap: number;
}) {
  const [result, setResult] = useState<AdminResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (action: (fd: FormData) => Promise<AdminResult>) => (formData: FormData) =>
    startTransition(async () => setResult(await action(formData)));

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-ink text-lg font-semibold">Pickup slot limits</h2>
        <p className="text-ink-muted text-sm">
          How many orders one pickup time can take. Slots with no entry here use the
          default of {defaultCap}. Set 0 to close a single time without closing the day.
        </p>
      </div>

      <form action={run(setSlotCapacityAction)} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-ink text-sm font-medium">Date</span>
          <input
            type="date"
            name="pickupDate"
            required
            className="rounded-control border-border bg-surface text-ink border px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink text-sm font-medium">Time</span>
          <input
            type="time"
            name="pickupTime"
            required
            className="rounded-control border-border bg-surface text-ink border px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink text-sm font-medium">Max orders</span>
          <input
            type="number"
            name="maxOrders"
            min={0}
            defaultValue={defaultCap}
            required
            className="rounded-control border-border bg-surface text-ink w-28 border px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-control bg-brand text-brand-ink hover:bg-brand-hover px-4 py-2 font-semibold transition-colors disabled:opacity-50"
        >
          Set limit
        </button>
      </form>

      <Feedback result={result} />

      {slots.length === 0 ? (
        <p className="text-ink-muted text-sm">
          No custom limits — every slot uses the default of {defaultCap}.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {slots.map((slot) => (
            <li
              key={`${slot.pickupDate}-${slot.pickupTime}`}
              className="rounded-control border-border bg-surface flex items-center justify-between border px-4 py-2"
            >
              <span className="text-ink">
                {formatStoreDate(slot.pickupDate, "medium")} at{" "}
                {formatPickupTime(slot.pickupTime)} &middot;{" "}
                <strong className="font-semibold">
                  {slot.maxOrders === 0 ? "closed" : `${slot.maxOrders} orders`}
                </strong>
              </span>
              <form action={run(clearSlotCapacityAction)}>
                <input type="hidden" name="pickupDate" value={slot.pickupDate} />
                <input type="hidden" name="pickupTime" value={slot.pickupTime} />
                <button
                  type="submit"
                  className="text-ink-subtle hover:text-danger text-sm underline transition-colors"
                >
                  Use default
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CatalogResync() {
  const [result, setResult] = useState<AdminResult | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-ink text-lg font-semibold">Item names and prices</h2>
        <p className="text-ink-muted text-sm">
          These come from your Square item library — edit them in the Square Dashboard and
          they update here automatically within the hour. Use this button to pull them
          through immediately.
        </p>
      </div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => startTransition(async () => setResult(await resyncCatalogAction()))}
        className="rounded-control border-border bg-surface text-ink hover:border-border-strong self-start border px-4 py-2 font-semibold transition-colors disabled:opacity-50"
      >
        {isPending ? "Syncing…" : "Sync from Square now"}
      </button>
      <Feedback result={result} successMessage="Pulled the latest from Square." />
    </section>
  );
}

function Feedback({
  result,
  successMessage = "Saved.",
}: {
  result: AdminResult | null;
  successMessage?: string;
}) {
  if (!result) return null;

  if (!result.ok) {
    return (
      <p role="alert" className="text-danger text-sm">
        {result.error}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p role="status" className="text-success text-sm">
        {successMessage}
      </p>
      {result.warnings?.map((warning) => (
        <p key={warning} className="text-warning text-sm">
          ⚠ {warning}
        </p>
      ))}
    </div>
  );
}
