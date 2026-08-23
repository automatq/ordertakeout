"use client";

import { useState, useTransition } from "react";

import { add86Action } from "@/app/actions/admin";
import type { StoreLocation } from "@/lib/locations/types";
import { useToast } from "@/components/ui/toast";

export interface EightySixProduct {
  id: string;
  name: string;
}

/**
 * "86 today" — the most-used control in any food back office, reachable from
 * the queue where staff notice they've run out. Date-scoped: the block expires
 * on its own, so nobody has to remember to switch an item back on.
 */
export function EightySixButton({
  products,
  locations,
  today,
  onChanged,
}: {
  products: EightySixProduct[];
  locations: StoreLocation[];
  /** Store-local current date, from the server — never the browser's clock. */
  today: string;
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [locationIds, setLocationIds] = useState<Set<string>>(
    () => new Set(locations.map((location) => location.id)),
  );
  const [reason, setReason] = useState("");
  const [initials, setInitials] = useState("");
  const [pending, startTransition] = useTransition();

  if (products.length === 0) return null;

  const toggleLocation = (id: string) => {
    setLocationIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = () => {
    startTransition(async () => {
      const result = await add86Action({
        productId,
        locationIds: [...locationIds],
        date,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(initials.trim() ? { staffInitials: initials.trim() } : {}),
      });
      if (!result.ok) {
        toast({ message: result.error, tone: "error" });
        return;
      }
      const name = products.find((product) => product.id === productId)?.name ?? "Item";
      toast({ message: `${name} marked sold out for ${date}.` });
      setOpen(false);
      setReason("");
      await onChanged();
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="btn btn-secondary btn-sm"
      >
        86 an item
      </button>

      {open ? (
        <div className="bg-canvas border-border shadow-raised absolute right-0 z-40 mt-2 flex w-80 flex-col gap-3 rounded-2xl border p-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="eightysix-product" className="text-ink-subtle text-xs font-medium">Item</label>
            <select
              id="eightysix-product"
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              className="input py-1.5 text-sm"
            >
              {products.map((product) => (
                <option key={product.id} value={product.id}>{product.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="eightysix-date" className="text-ink-subtle text-xs font-medium">Sold out for</label>
            <input
              id="eightysix-date"
              type="date"
              value={date}
              min={today}
              onChange={(event) => setDate(event.target.value)}
              className="input py-1.5 text-sm"
            />
          </div>
          {locations.length > 1 ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-ink-subtle text-xs font-medium">At</legend>
              {locations.map((location) => (
                <label key={location.id} className="text-ink flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={locationIds.has(location.id)}
                    onChange={() => toggleLocation(location.id)}
                  />
                  {location.name}
                </label>
              ))}
            </fieldset>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="eightysix-reason" className="text-ink-subtle text-xs font-medium">Reason (optional)</label>
            <input
              id="eightysix-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={120}
              placeholder="Oven capacity"
              className="input py-1.5 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="eightysix-initials" className="text-ink-subtle text-xs font-medium">Your initials (optional)</label>
            <input
              id="eightysix-initials"
              value={initials}
              onChange={(event) => setInitials(event.target.value)}
              maxLength={6}
              className="input py-1.5 text-sm"
            />
          </div>
          <p className="text-ink-subtle text-xs">
            Blocks new orders for that day only. Paid orders are unaffected. Existing orders keep their pickup.
          </p>
          <button
            type="button"
            disabled={pending || locationIds.size === 0}
            onClick={submit}
            className="btn btn-primary btn-sm"
          >
            {pending ? <span className="spinner" aria-hidden /> : null}
            Mark sold out
          </button>
        </div>
      ) : null}
    </div>
  );
}
