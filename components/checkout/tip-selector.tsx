"use client";

import { useState } from "react";

import { formatMoney } from "@/lib/square/money";

/**
 * Gratuity picker for the payment step. Percentages are computed on the
 * server-confirmed pre-tax subtotal and rounded to the cent; the charge itself
 * uses the same integer the label shows. Tips ride on the payment, not the
 * Square order, so changing the tip never re-prices the order.
 */
const PRESETS = [0, 10, 15, 20] as const;

export function TipSelector({
  subtotalCents,
  tipCents,
  currency,
  disabled,
  onChange,
}: {
  subtotalCents: number;
  tipCents: number;
  currency: string;
  disabled?: boolean;
  onChange: (tipCents: number) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");

  const presetFor = (percent: number) => Math.round((subtotalCents * percent) / 100);
  const activePreset = customOpen
    ? null
    : PRESETS.find((percent) => presetFor(percent) === tipCents);

  const applyCustom = (raw: string) => {
    setCustomValue(raw);
    const parsed = Math.round(Number.parseFloat(raw || "0") * 100);
    onChange(Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, subtotalCents) : 0);
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-ink-subtle text-sm font-medium">Add a tip for the bakery team? (optional)</legend>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((percent) => {
          const cents = presetFor(percent);
          const active = activePreset === percent;
          return (
            <button
              key={percent}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => {
                setCustomOpen(false);
                setCustomValue("");
                onChange(cents);
              }}
              className={`rounded-pill border px-3 py-1.5 text-sm font-semibold transition-colors ${
                active
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-border bg-surface text-ink-muted hover:border-border-strong"
              }`}
            >
              {percent === 0 ? "No tip" : `${percent}% · ${formatMoney(cents, currency)}`}
            </button>
          );
        })}
        <button
          type="button"
          disabled={disabled}
          aria-pressed={customOpen}
          onClick={() => setCustomOpen((current) => !current)}
          className={`rounded-pill border px-3 py-1.5 text-sm font-semibold transition-colors ${
            customOpen
              ? "border-brand bg-brand-soft text-brand"
              : "border-border bg-surface text-ink-muted hover:border-border-strong"
          }`}
        >
          Custom
        </button>
      </div>
      {customOpen ? (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-subtle font-medium">Amount ({currency})</span>
          <input
            value={customValue}
            onChange={(event) => applyCustom(event.target.value)}
            inputMode="decimal"
            disabled={disabled}
            className="input w-28 py-1.5"
          />
        </label>
      ) : null}
      {tipCents > 0 ? (
        <p className="text-ink-subtle text-xs">
          {formatMoney(tipCents, currency)} tip — added to your card charge, never to the order price.
        </p>
      ) : null}
    </fieldset>
  );
}
