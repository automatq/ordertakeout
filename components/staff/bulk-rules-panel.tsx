"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveProductRulesBulkAction, type AdminResult } from "@/app/actions/admin";
import { AlertIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import {
  ALLERGEN_LABELS,
  ALLERGENS,
  DIETARY_LABELS,
  DIETARY_TAGS,
} from "@/lib/catalog/dietary";
import { formatPickupTime } from "@/lib/scheduling/time";

/**
 * Configure many products in one go.
 *
 * A full bakery menu is dozens of items that share one rule — bread is ordered
 * the same day and collected any time the shop is open — with a handful of
 * pre-order exceptions. Doing that one form at a time is roughly forty clicks
 * per product, and the per-product defaults are shaped for party trays, so the
 * quick path also produced the wrong answer for everyday items.
 *
 * Pickup times are a window plus an interval rather than a chip grid. The grid
 * on the single-product form runs 06:00–21:30 in half hours, which cannot
 * express the shop's actual 5:45 AM opening at all; a window can, and "every 30
 * minutes from 05:45 to 21:00" is also just easier to say than picking 31 chips.
 */

const PRESETS = {
  everyday: {
    label: "Everyday item",
    hint: "Same-day, collect any time the shop is open",
    leadTimeDays: "0",
    orderCutoffTime: "20:00",
    from: "05:45",
    to: "21:00",
    interval: 30,
  },
  tray: {
    label: "Party tray",
    hint: "A day's notice, evening collection",
    leadTimeDays: "1",
    orderCutoffTime: "18:00",
    from: "16:00",
    to: "20:00",
    interval: 60,
  },
} as const;

function timesInWindow(from: string, to: string, interval: number): string[] {
  const toMinutes = (value: string) => {
    const [h, m] = value.split(":");
    return Number(h) * 60 + Number(m);
  };
  const start = toMinutes(from);
  const end = toMinutes(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || interval < 5) return [];

  const times: string[] = [];
  for (let minute = start; minute <= end && times.length < 200; minute += interval) {
    times.push(
      `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
    );
  }
  return times;
}

export function BulkRulesPanel({
  productIds,
  onApplied,
}: {
  productIds: string[];
  onApplied: () => void;
}) {
  const [preset, setPreset] = useState<keyof typeof PRESETS>("everyday");
  const [leadTimeDays, setLeadTimeDays] = useState<string>(PRESETS.everyday.leadTimeDays);
  const [orderCutoffTime, setOrderCutoffTime] = useState<string>(PRESETS.everyday.orderCutoffTime);
  const [from, setFrom] = useState<string>(PRESETS.everyday.from);
  const [to, setTo] = useState<string>(PRESETS.everyday.to);
  const [interval, setInterval] = useState<number>(PRESETS.everyday.interval);
  const [maxUnitsPerDay, setMaxUnitsPerDay] = useState("");
  const [isOrderable, setIsOrderable] = useState(true);
  const [allergens, setAllergens] = useState<string[]>([]);
  const [dietaryTags, setDietaryTags] = useState<string[]>([]);
  const [result, setResult] = useState<AdminResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const router = useRouter();
  const toast = useToast();

  const times = useMemo(() => timesInWindow(from, to, interval), [from, to, interval]);

  function applyPreset(key: keyof typeof PRESETS) {
    const next = PRESETS[key];
    setPreset(key);
    setLeadTimeDays(next.leadTimeDays);
    setOrderCutoffTime(next.orderCutoffTime);
    setFrom(next.from);
    setTo(next.to);
    setInterval(next.interval);
  }

  function handleApply() {
    startTransition(async () => {
      try {
        const next = await saveProductRulesBulkAction({
          productIds,
          leadTimeDays,
          orderCutoffTime,
          pickupTimes: times.join(", "),
          maxUnitsPerDay,
          isOrderable: isOrderable ? "true" : "false",
          allergens: allergens.join(","),
          dietaryTags: dietaryTags.join(","),
        });
        setResult(next);
        if (next.ok) {
          toast({
            message: `Rules applied to ${productIds.length} product${productIds.length === 1 ? "" : "s"}.`,
          });
          onApplied();
          router.refresh();
        } else {
          toast({ tone: "error", message: next.error });
        }
      } catch {
        const next: AdminResult = {
          ok: false,
          error: "We couldn't apply those rules. Check your connection and try again.",
        };
        setResult(next);
        toast({ tone: "error", message: next.error });
      }
    });
  }

  const errors = result && !result.ok ? result.fieldErrors : undefined;
  const blocked = productIds.length === 0 || times.length === 0;

  return (
    <div className="panel flex flex-col gap-5 p-5">
      <div>
        <h3 className="text-ink text-sm font-medium">
          Apply rules to {productIds.length} selected product{productIds.length === 1 ? "" : "s"}
        </h3>
        <p className="text-ink-subtle text-sm">
          Ordering rules and allergens only. Each product keeps its own URL name, description
          and photo.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-ink text-sm font-medium">Start from</legend>
        <div className="flex flex-wrap gap-2 pt-1">
          {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={preset === key}
              onClick={() => applyPreset(key)}
              className={`btn btn-sm rounded-full ${preset === key ? "btn-primary" : "btn-outline"}`}
            >
              {PRESETS[key].label}
            </button>
          ))}
        </div>
        <span className="field-hint">{PRESETS[preset].hint}</span>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-ink-subtle text-sm font-medium">Days in advance</span>
          <input
            type="number"
            min={0}
            value={leadTimeDays}
            onChange={(event) => setLeadTimeDays(event.target.value)}
            className="input"
          />
          <span className="field-hint">0 = can be collected the same day</span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-ink-subtle text-sm font-medium">Order cutoff</span>
          <input
            type="time"
            value={orderCutoffTime}
            onChange={(event) => setOrderCutoffTime(event.target.value)}
            className="input"
          />
          <span className="field-hint">Last moment an order can be placed</span>
        </label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-ink text-sm font-medium">Pickup times</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-ink-subtle text-sm">From</span>
            <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className="input" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-ink-subtle text-sm">To</span>
            <input type="time" value={to} onChange={(e) => setTo(e.target.value)} className="input" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-ink-subtle text-sm">Every</span>
            <select
              value={interval}
              onChange={(event) => setInterval(Number(event.target.value))}
              className="input"
            >
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
            </select>
          </label>
        </div>
        {errors?.["pickupTimes"] ? (
          <span role="alert" className="field-error">{errors["pickupTimes"][0]}</span>
        ) : times.length === 0 ? (
          <span role="alert" className="field-error">
            That window produces no pickup times &mdash; check the from and to values.
          </span>
        ) : (
          <span className="field-hint">
            {times.length} pickup time{times.length === 1 ? "" : "s"}:{" "}
            {formatPickupTime(times[0]!)}
            {times.length > 1 ? ` – ${formatPickupTime(times[times.length - 1]!)}` : ""}
          </span>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-ink-subtle text-sm font-medium">Max per day</span>
          <input
            type="number"
            min={1}
            value={maxUnitsPerDay}
            onChange={(event) => setMaxUnitsPerDay(event.target.value)}
            placeholder="No limit"
            className="input"
          />
          <span className="field-hint">Leave blank for no limit</span>
        </label>

        <label className="flex items-center gap-2 pt-8">
          <input
            type="checkbox"
            checked={isOrderable}
            onChange={(event) => setIsOrderable(event.target.checked)}
            className="accent-brand h-5 w-5"
          />
          <span className="text-ink text-sm">Available to order</span>
        </label>
      </div>

      <ChipField
        legend="Contains allergens"
        options={ALLERGENS}
        labels={ALLERGEN_LABELS}
        selected={allergens}
        onToggle={setAllergens}
        hint="Applied to every selected product. Leaving one off is not a &ldquo;free from&rdquo; claim."
      />

      <ChipField
        legend="Dietary notes"
        options={DIETARY_TAGS}
        labels={DIETARY_LABELS}
        selected={dietaryTags}
        onToggle={setDietaryTags}
        hint="Applied to every selected product."
      />

      {result?.ok && result.warnings?.length ? (
        <ul className="text-warning flex flex-col gap-1 text-sm" role="status">
          {result.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      {result && !result.ok ? (
        <p role="alert" className="field-error">{result.error}</p>
      ) : null}

      <button
        type="button"
        onClick={handleApply}
        disabled={isPending || blocked}
        className="btn btn-primary btn-sm self-start rounded-full"
      >
        {isPending ? <span className="spinner" aria-hidden /> : null}
        {isPending
          ? "Applying…"
          : `Apply to ${productIds.length} product${productIds.length === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}

function ChipField<T extends string>({
  legend,
  options,
  labels,
  selected,
  onToggle,
  hint,
}: {
  legend: string;
  options: readonly T[];
  labels: Record<T, string>;
  selected: string[];
  onToggle: (next: string[]) => void;
  hint: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-ink text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2 pt-1">
        {options.map((option) => {
          const chosen = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={chosen}
              onClick={() =>
                onToggle(chosen ? selected.filter((value) => value !== option) : [...selected, option])
              }
              className="chip btn-sm text-sm"
            >
              {labels[option]}
            </button>
          );
        })}
      </div>
      <span className="field-hint">{hint}</span>
    </fieldset>
  );
}
