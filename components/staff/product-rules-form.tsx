"use client";

import { useState, useTransition } from "react";

import { saveProductRulesAction, type AdminResult } from "@/app/actions/admin";
import type { ProductRuleRow } from "@/lib/admin/queries";

/**
 * Ordering rules for one product.
 *
 * Used both to edit a configured product and to configure one Square has but we
 * have never seen — the same fields either way, which is why it's an upsert.
 */
export function ProductRulesForm({
  productId,
  productName,
  existing,
  unconfigured,
}: {
  productId: string;
  productName: string;
  existing?: ProductRuleRow;
  unconfigured?: boolean;
}) {
  const [result, setResult] = useState<AdminResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => setResult(await saveProductRulesAction(formData)));
  }

  const errors = result && !result.ok ? result.fieldErrors : undefined;

  return (
    <form
      action={handleSubmit}
      className="rounded-card border-border bg-surface flex flex-col gap-4 border p-5"
    >
      <input type="hidden" name="productId" value={productId} />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-ink font-semibold">{productName}</h3>
        {unconfigured ? (
          <span className="bg-status-preparing-soft text-status-preparing rounded-control px-2 py-1 text-xs font-semibold">
            Not yet orderable — needs rules
          </span>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="URL name"
          name="slug"
          defaultValue={existing?.slug ?? suggestSlug(productName)}
          hint="Appears in the product link"
          errors={errors?.["slug"]}
        />
        <Field
          label="Days in advance"
          name="leadTimeDays"
          type="number"
          defaultValue={String(existing?.leadTimeDays ?? 1)}
          hint="1 = order today, collect tomorrow"
          errors={errors?.["leadTimeDays"]}
        />
        <Field
          label="Order cutoff"
          name="orderCutoffTime"
          defaultValue={existing?.orderCutoffTime ?? "18:00"}
          hint="24-hour, e.g. 18:00 for 6 PM"
          errors={errors?.["orderCutoffTime"]}
        />
        <Field
          label="Max trays per day"
          name="maxUnitsPerDay"
          type="number"
          defaultValue={existing?.maxUnitsPerDay?.toString() ?? ""}
          hint="Leave blank for no limit"
          errors={errors?.["maxUnitsPerDay"]}
        />
      </div>

      <Field
        label="Pickup times"
        name="pickupTimes"
        defaultValue={(existing?.allowedPickupTimes ?? ["16:00", "17:00", "18:00", "19:00", "20:00"]).join(", ")}
        hint="24-hour times, comma separated — e.g. 16:00, 17:00, 18:00"
        errors={errors?.["pickupTimes"]}
      />

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="isOrderable"
          value="true"
          defaultChecked={existing?.isOrderable ?? true}
          className="accent-brand"
        />
        <span className="text-ink text-sm">Available to order</span>
      </label>

      {result?.ok && result.warnings?.length ? (
        <ul className="text-warning flex flex-col gap-1 text-sm" role="status">
          {result.warnings.map((warning) => (
            <li key={warning}>⚠ {warning}</li>
          ))}
        </ul>
      ) : null}

      {result?.ok ? (
        <p role="status" className="text-success text-sm">
          Saved.
        </p>
      ) : result ? (
        <p role="alert" className="text-danger text-sm">
          {result.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-control bg-brand text-brand-ink hover:bg-brand-hover self-start px-5 py-2.5 font-semibold transition-colors disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Save rules"}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  hint,
  errors,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue?: string;
  hint?: string;
  errors?: string[];
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ink text-sm font-medium">{label}</span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        aria-invalid={errors ? true : undefined}
        className="rounded-control border-border bg-surface text-ink border px-3 py-2"
      />
      {errors?.length ? (
        <span role="alert" className="text-danger text-xs">
          {errors[0]}
        </span>
      ) : hint ? (
        <span className="text-ink-subtle text-xs">{hint}</span>
      ) : null}
    </label>
  );
}

function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
