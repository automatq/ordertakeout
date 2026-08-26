"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setSlotCapacityDefaultAction } from "@/app/actions/admin";
import { useToast } from "@/components/ui/toast";

export interface CapacityDefaultRow {
  /** Null is the value used by any location without its own. */
  locationId: string | null;
  locationName: string;
  configured: number | null;
  effective: number;
}

/**
 * How many orders each pickup slot accepts by default.
 *
 * The number counts *orders*, not items — it is how many customers the counter
 * can hand over to inside one pickup window. How many of a product can be made
 * in a day is a different limit and lives on the product's own rules.
 *
 * This was a constant in the source whose comment read "Confirm with the
 * store", which meant the only way to answer that question was a code change.
 * Five orders an hour is a party-tray assumption; a bakery selling bread across
 * the whole trading day needs a far higher number, and only the bakery knows
 * what it is.
 */
export function SlotCapacityDefaults({ rows }: { rows: CapacityDefaultRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-ink text-lg font-semibold">Default orders per slot</h2>
        <p className="text-ink-muted text-sm">
          How many separate orders one pickup time can hold. Set one number for the shop,
          and override it for a branch whose counter is faster or slower. Individual dates
          are capped below.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          /* Keyed on the resolved value, not just the id: saving the overall
             number re-renders this list, and without a remount each location's
             input would keep the number it was first given while its own note
             reported the new one. Staff would then see a stale 5 sitting in the
             box and Save it, pinning that branch at 5 by accident. */
          <CapacityRow
            key={`${row.locationId ?? "global"}:${row.configured ?? row.effective}`}
            row={row}
          />
        ))}
      </ul>
    </div>
  );
}

function CapacityRow({ row }: { row: CapacityDefaultRow }) {
  const [value, setValue] = useState(String(row.configured ?? row.effective));
  const [isPending, startTransition] = useTransition();
  const inputId = `slot-default-${row.locationId ?? "global"}`;
  const router = useRouter();
  const toast = useToast();

  const dirty = value !== String(row.configured ?? row.effective);

  function handleSave() {
    startTransition(async () => {
      const result = await setSlotCapacityDefaultAction({
        locationId: row.locationId,
        maxOrdersPerSlot: value,
      });
      if (result.ok) {
        toast({ message: `${row.locationName}: ${value} orders per slot.` });
        router.refresh();
      } else {
        toast({ tone: "error", message: result.error });
      }
    });
  }

  return (
    /* Name on its own line rather than beside the field: branch names are long
       and of differing lengths, and inline labels made the inputs start at a
       different x on every row. */
    <li className="card flex flex-col gap-3 p-5">
      <label htmlFor={inputId} className="text-ink text-sm font-medium">
        {row.locationName}
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <input
          id={inputId}
          type="number"
          min={1}
          max={500}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="input w-28"
        />

        <span className="text-ink-muted text-sm">
          {row.configured === null
            ? row.locationId
              ? `Using the shop default (${row.effective})`
              : `Not set — using ${row.effective}`
            : `${row.configured} orders per slot`}
        </span>

        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || !dirty}
          className="btn btn-primary btn-sm ml-auto"
        >
          {isPending ? <span className="spinner" aria-hidden /> : null}
          Save
        </button>
      </div>
    </li>
  );
}
