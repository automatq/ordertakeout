"use client";

import { useId, useState } from "react";

/**
 * Quantity control.
 *
 * Replaces the bare `<input type="number">` used on the product page and in the
 * cart. Native spinners are a ~10px target on desktop, absent on touch, and the
 * old handler clamped silently — type 99 and it became 50 with no explanation.
 * `onClamp` exists so the caller can say something about that.
 *
 * The value stays a real input so it remains typeable and labelled; the buttons
 * are the primary affordance.
 */
export function QuantityStepper({
  label,
  value,
  min = 1,
  max = 50,
  onChange,
  onClamp,
  size = "md",
}: {
  /** Accessible name — include the item, e.g. "Quantity of 25 pcs Ube". */
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  /** Called with what the customer actually typed when it had to be clamped. */
  onClamp?: (attempted: number) => void;
  size?: "sm" | "md";
}) {
  const id = useId();

  /**
   * What's in the box while it's being edited.
   *
   * Without this, clearing the field to retype snaps it straight back to `min`
   * on the first keystroke, so "10" can only be reached by selecting all first.
   */
  const [draft, setDraft] = useState<string | null>(null);

  function commit(raw: string) {
    setDraft(null);
    const parsed = Number(raw);

    if (!Number.isFinite(parsed) || parsed < min) {
      onChange(min);
      return;
    }

    const clamped = Math.min(Math.floor(parsed), max);
    if (clamped !== Math.floor(parsed)) onClamp?.(Math.floor(parsed));
    onChange(clamped);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-ink-subtle text-sm font-medium">
        {size === "sm" ? <span className="sr-only">{label}</span> : label}
      </label>

      <div className="stepper">
        <button
          type="button"
          className="stepper-btn"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
        >
          &minus;
        </button>

        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={draft ?? value}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit(event.currentTarget.value);
            }
          }}
          className="stepper-value"
        />

        <button
          type="button"
          className="stepper-btn"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
}
