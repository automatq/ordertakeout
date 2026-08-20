"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

import {
  addBlackoutAction,
  clearSlotCapacityAction,
  removeBlackoutAction,
  resyncCatalogAction,
  setSlotCapacityAction,
  type AdminResult,
} from "@/app/actions/admin";
import { EmptyState } from "@/components/ui/empty-state";
import { AlertIcon, CalendarIcon, ClockIcon, RefreshIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { formatPickupTime, formatStoreDate } from "@/lib/scheduling/time";
import type { StoreLocation } from "@/lib/locations/types";

/**
 * Closure dates, per-slot caps, and the catalog re-sync button.
 *
 * The shared `useAdminAction` hook below fixes two things these forms had in
 * common. First, the list under each form is a prop from the server page, and
 * nothing re-rendered it after a mutation — the actions invalidate the cached
 * catalog tag, but this page reads the database directly, so "Saved." could sit
 * above a list that visibly disagreed with it. A `router.refresh()` on success
 * settles that. Second, every result raises a toast, so feedback survives being
 * scrolled past on a long settings page.
 */

function useAdminAction() {
  const router = useRouter();
  const toast = useToast();
  const [result, setResult] = useState<AdminResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = useCallback(
    (action: (formData: FormData) => Promise<AdminResult>, successMessage: string) =>
      (formData: FormData) =>
        startTransition(async () => {
          try {
            const next = await action(formData);
            setResult(next);

            if (next.ok) {
              toast({ message: successMessage });
              // Re-read the list this form just changed.
              router.refresh();
            } else {
              toast({ tone: "error", message: next.error });
            }
          } catch {
            const next: AdminResult = {
              ok: false,
              error: "That change didn't save. Check the connection and try again.",
            };
            setResult(next);
            toast({ tone: "error", message: next.error });
          }
        }),
    [router, toast],
  );

  return { run, result, isPending, setResult };
}

export function BlackoutDates({
  dates,
  locations,
}: {
  dates: { locationId: string | null; date: string; reason: string | null }[];
  locations: StoreLocation[];
}) {
  const { run, result, isPending } = useAdminAction();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-ink text-lg font-semibold">Closure dates</h2>
        <p className="text-ink-muted text-sm">
          No pickups are offered on these days. Holidays, deep cleans, staff days off.
        </p>
      </div>

      <form
        action={run(addBlackoutAction, "Closure added.")}
        className="card flex flex-wrap items-end gap-3 p-5"
      >
        <LocationField locations={locations} id="blackout-location" />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="blackout-date" className="text-ink text-sm font-medium">
            Date
          </label>
          <input id="blackout-date" type="date" name="date" required className="input" />
        </div>

        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <label htmlFor="blackout-reason" className="text-ink text-sm font-medium">
            Reason (optional)
          </label>
          <input
            id="blackout-reason"
            type="text"
            name="reason"
            placeholder="Christmas Day"
            className="input"
          />
        </div>

        <button type="submit" disabled={isPending} className="btn btn-primary btn-sm">
          {isPending ? <span className="spinner" aria-hidden /> : null}
          Add closure
        </button>
      </form>

      <Feedback result={result} />

      {dates.length === 0 ? (
        <EmptyState
          compact
          icon={<CalendarIcon className="h-5 w-5" />}
          title="No upcoming closures"
          description="The shop is taking pickups on every day it's open."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {dates.map((entry) => (
            <li
              key={`${entry.locationId ?? "legacy"}-${entry.date}`}
              className="rounded-control border-border bg-surface flex flex-wrap items-center justify-between gap-3 border px-4 py-3"
            >
              <span className="text-ink">
                <strong className="font-semibold">
                  {locations.find((location) => location.id === entry.locationId)?.name ?? "All locations (legacy)"}
                </strong>{" — "}
                {formatStoreDate(entry.date)}
                {entry.reason ? <span className="text-ink-muted"> — {entry.reason}</span> : null}
              </span>
              {entry.locationId ? <form action={run(removeBlackoutAction, "Closure removed.")}>
                <input type="hidden" name="locationId" value={entry.locationId} />
                <input type="hidden" name="date" value={entry.date} />
                {/* A real button, not an underlined text link: this reopens the
                    shop for a day, and it should look like the control it is. */}
                <button type="submit" className="btn btn-sm btn-danger">
                  Remove
                </button>
              </form> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SlotCapacity({
  slots,
  defaultCap,
  locations,
}: {
  slots: { locationId: string | null; pickupDate: string; pickupTime: string; maxOrders: number }[];
  defaultCap: number;
  locations: StoreLocation[];
}) {
  const { run, result, isPending } = useAdminAction();
  /**
   * "Close this slot" is the same write as a cap of 0, but it was documented
   * only in a sentence of body copy — so the one destructive thing this form
   * can do was the one thing it never offered as a control.
   */
  const [closeSlot, setCloseSlot] = useState(false);
  const [maxOrders, setMaxOrders] = useState(String(defaultCap));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-ink text-lg font-semibold">Pickup slot limits</h2>
        <p className="text-ink-muted text-sm">
          How many orders one pickup time can take. Slots with no entry here use the
          default of {defaultCap}.
        </p>
      </div>

      <form
        action={run(setSlotCapacityAction, "Slot limit saved.")}
        className="card flex flex-wrap items-end gap-3 p-5"
      >
        <LocationField locations={locations} id="slot-location" />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="slot-date" className="text-ink text-sm font-medium">
            Date
          </label>
          <input id="slot-date" type="date" name="pickupDate" required className="input" />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="slot-time" className="text-ink text-sm font-medium">
            Time
          </label>
          <input id="slot-time" type="time" name="pickupTime" required className="input" />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="slot-max" className="text-ink text-sm font-medium">
            Max orders
          </label>
          <input
            id="slot-max"
            type="number"
            name="maxOrders"
            min={0}
            /* Driven by the toggle, so the two controls can't contradict each
               other — a "closed" slot with a cap of 5 would be a lie. */
            value={closeSlot ? "0" : maxOrders}
            onChange={(event) => setMaxOrders(event.target.value)}
            readOnly={closeSlot}
            required
            className="input w-28"
          />
        </div>

        <label className="text-ink flex items-center gap-2 pb-3 text-sm">
          <input
            type="checkbox"
            checked={closeSlot}
            onChange={(event) => setCloseSlot(event.target.checked)}
            className="accent-brand h-5 w-5"
          />
          Close this time
        </label>

        <button type="submit" disabled={isPending} className="btn btn-primary btn-sm">
          {isPending ? <span className="spinner" aria-hidden /> : null}
          {closeSlot ? "Close slot" : "Set limit"}
        </button>
      </form>

      <Feedback result={result} />

      {slots.length === 0 ? (
        <EmptyState
          compact
          icon={<ClockIcon className="h-5 w-5" />}
          title="No custom limits"
          description={`Every slot uses the default of ${defaultCap} orders.`}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {slots.map((slot) => (
            <li
              key={`${slot.locationId ?? "legacy"}-${slot.pickupDate}-${slot.pickupTime}`}
              className="rounded-control border-border bg-surface flex flex-wrap items-center justify-between gap-3 border px-4 py-3"
            >
              <span className="text-ink">
                <strong className="font-semibold">
                  {locations.find((location) => location.id === slot.locationId)?.name ?? "All locations (legacy)"}
                </strong>{" — "}
                {formatStoreDate(slot.pickupDate, "medium")} at{" "}
                {formatPickupTime(slot.pickupTime)} &middot;{" "}
                {slot.maxOrders === 0 ? (
                  <strong className="text-danger font-semibold">closed</strong>
                ) : (
                  <strong className="font-semibold">{slot.maxOrders} orders</strong>
                )}
              </span>
              {slot.locationId ? <form action={run(clearSlotCapacityAction, "Slot back to the default.")}>
                <input type="hidden" name="locationId" value={slot.locationId} />
                <input type="hidden" name="pickupDate" value={slot.pickupDate} />
                <input type="hidden" name="pickupTime" value={slot.pickupTime} />
                <button type="submit" className="btn btn-sm btn-secondary">
                  Use default
                </button>
              </form> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LocationField({ locations, id }: { locations: StoreLocation[]; id: string }) {
  return (
    <div className="flex min-w-56 flex-col gap-1.5">
      <label htmlFor={id} className="text-ink text-sm font-medium">Location</label>
      <select id={id} name="locationId" required className="input" defaultValue="">
        <option value="" disabled>Choose a location</option>
        {locations.map((location) => (
          <option key={location.id} value={location.id}>{location.name}</option>
        ))}
      </select>
    </div>
  );
}

export function CatalogResync() {
  const router = useRouter();
  const toast = useToast();
  const [result, setResult] = useState<AdminResult | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3">
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
        onClick={() =>
          startTransition(async () => {
            const next = await resyncCatalogAction();
            setResult(next);
            if (next.ok) {
              toast({ message: "Pulled the latest from Square." });
              router.refresh();
            } else {
              toast({ tone: "error", message: next.error });
            }
          })
        }
        className="btn btn-secondary btn-sm self-start"
      >
        <RefreshIcon className={`h-4 w-4 ${isPending ? "animate-spin-slow" : ""}`} />
        {isPending ? "Syncing…" : "Sync from Square now"}
      </button>
      <Feedback result={result} successMessage="Pulled the latest from Square." />
    </div>
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
      <p role="alert" className="field-error">
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
        <p key={warning} className="text-warning flex items-start gap-2 text-sm">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          {warning}
        </p>
      ))}
    </div>
  );
}
