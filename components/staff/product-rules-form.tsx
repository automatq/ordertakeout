"use client";

import { useEffect, useId, useState, useTransition } from "react";

import { saveProductRulesAction, type AdminResult } from "@/app/actions/admin";
import { AlertIcon, CheckIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import type { ProductRuleRow } from "@/lib/admin/queries";
import {
  ALLERGEN_LABELS,
  ALLERGENS,
  DIETARY_LABELS,
  DIETARY_TAGS,
} from "@/lib/catalog/dietary";
import { formatPickupTime } from "@/lib/scheduling/time";

/**
 * Ordering rules for one product.
 *
 * Used both to edit a configured product and to configure one Square has but we
 * have never seen — the same fields either way, which is why it's an upsert.
 *
 * Rendered inside a `<details>` on the settings page: forty Square items used to
 * mean forty fully-expanded six-field forms stacked in one column.
 *
 * Two smaller fixes here:
 *
 *  - Pickup times are chips, not free text. A comma-separated string meant one
 *    typo silently reshaped storefront availability, and the field's format hint
 *    disappeared exactly when the format was wrong (the hint and error shared a
 *    slot). The hidden input keeps the server contract unchanged.
 *  - Saving raises a toast as well as an inline note. With forty forms on a
 *    page, the "Saved." under the one you edited scrolls away with it.
 */

const DEFAULT_PICKUP_TIMES = ["16:00", "17:00", "18:00", "19:00", "20:00"];

/** Every half hour the shop could plausibly offer, for the chip picker. */
const SELECTABLE_TIMES = Array.from({ length: 32 }, (_, index) => {
  const minutes = 6 * 60 + index * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

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
  const [pickupTimes, setPickupTimes] = useState<string[]>(
    existing?.allowedPickupTimes ?? DEFAULT_PICKUP_TIMES,
  );
  const [allergens, setAllergens] = useState<string[]>(existing?.allergens ?? []);
  const [dietaryTags, setDietaryTags] = useState<string[]>(existing?.dietaryTags ?? []);
  const [dirty, setDirty] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const guardClientNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const next = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      // In-page settings jump links do not unmount the form or lose its values.
      if (next.pathname === current.pathname && next.search === current.search) return;
      if (window.confirm("Leave without saving these product rules?")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    document.addEventListener("click", guardClientNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeLeaving);
      document.removeEventListener("click", guardClientNavigation, true);
    };
  }, [dirty]);

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        const next = await saveProductRulesAction(formData);
        setResult(next);
        if (next.ok) {
          setDirty(false);
          toast({ message: `${productName} rules saved.` });
        } else {
          toast({ tone: "error", message: `${productName}: ${next.error}` });
        }
      } catch {
        const next: AdminResult = {
          ok: false,
          error: "We couldn't save these rules. Check your connection and try again.",
        };
        setResult(next);
        toast({ tone: "error", message: `${productName}: ${next.error}` });
      }
    });
  }

  const errors = result && !result.ok ? result.fieldErrors : undefined;

  return (
    <form
      action={handleSubmit}
      onChange={() => setDirty(true)}
      className="card flex flex-col gap-4 p-5"
    >
      <input type="hidden" name="productId" value={productId} />
      {/* The server still parses a comma-separated string; the chips above are
          purely how staff choose the values. */}
      <input type="hidden" name="pickupTimes" value={pickupTimes.join(", ")} />
      <input type="hidden" name="allergens" value={allergens.join(", ")} />
      <input type="hidden" name="dietaryTags" value={dietaryTags.join(", ")} />

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
          type="time"
          defaultValue={existing?.orderCutoffTime ?? "18:00"}
          hint="Last moment an order can be placed"
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

      <fieldset className="flex flex-col gap-2">
        <legend className="text-ink text-sm font-medium">Pickup times</legend>
        <div className="flex flex-wrap gap-2 pt-1">
          {SELECTABLE_TIMES.map((time) => {
            const chosen = pickupTimes.includes(time);
            return (
              <button
                key={time}
                type="button"
                aria-pressed={chosen}
                onClick={() => {
                  setDirty(true);
                  setPickupTimes((current) =>
                    chosen
                      ? current.filter((t) => t !== time)
                      : [...current, time].sort((a, b) => a.localeCompare(b)),
                  );
                }}
                className="chip btn-sm text-sm"
              >
                {formatPickupTime(time)}
              </button>
            );
          })}
        </div>
        {errors?.["pickupTimes"] ? (
          <span role="alert" className="field-error">
            {errors["pickupTimes"][0]}
          </span>
        ) : null}
        <span className="field-hint">
          {pickupTimes.length === 0
            ? "Choose at least one — with none, the product can't be ordered."
            : `${pickupTimes.length} time${pickupTimes.length === 1 ? "" : "s"} offered.`}
        </span>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-ink text-sm font-medium">Contains allergens</legend>
        <div className="flex flex-wrap gap-2 pt-1">
          {ALLERGENS.map((allergen) => {
            const chosen = allergens.includes(allergen);
            return (
              <button
                key={allergen}
                type="button"
                aria-pressed={chosen}
                onClick={() => {
                  setDirty(true);
                  setAllergens((current) =>
                    chosen
                      ? current.filter((value) => value !== allergen)
                      : [...current, allergen],
                  );
                }}
                className="chip btn-sm text-sm"
              >
                {ALLERGEN_LABELS[allergen]}
              </button>
            );
          })}
        </div>
        {errors?.["allergens"] ? (
          <span role="alert" className="field-error">
            {errors["allergens"][0]}
          </span>
        ) : (
          <span className="field-hint">
            Shown on the product page with a shared-kitchen note. Leaving one off is not a
            &ldquo;free from&rdquo; claim.
          </span>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-ink text-sm font-medium">Dietary notes</legend>
        <div className="flex flex-wrap gap-2 pt-1">
          {DIETARY_TAGS.map((tag) => {
            const chosen = dietaryTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={chosen}
                onClick={() => {
                  setDirty(true);
                  setDietaryTags((current) =>
                    chosen ? current.filter((value) => value !== tag) : [...current, tag],
                  );
                }}
                className="chip btn-sm text-sm"
              >
                {DIETARY_LABELS[tag]}
              </button>
            );
          })}
        </div>
        {errors?.["dietaryTags"] ? (
          <span role="alert" className="field-error">
            {errors["dietaryTags"][0]}
          </span>
        ) : (
          <span className="field-hint">Shown on menu cards and the product page.</span>
        )}
      </fieldset>

      <Field
        label="Photo URL (optional)"
        name="heroImageUrl"
        defaultValue={existing?.heroImageUrl ?? ""}
        hint="Use a Square image URL or a deployed /harina/ asset. Leave blank to use the item's Square photo."
        errors={errors?.["heroImageUrl"]}
      />

      <label className="flex flex-col gap-1.5">
        <span className="text-ink-subtle text-sm font-medium">Storefront description</span>
        <textarea
          name="descriptionMd"
          defaultValue={existing?.descriptionMd ?? ""}
          rows={5}
          maxLength={2000}
          aria-invalid={errors?.["descriptionMd"]?.length ? true : undefined}
          aria-describedby={errors?.["descriptionMd"]?.length ? `rules-description-error-${productId}` : undefined}
          className="input"
          placeholder="Tell customers what is included, how it tastes, and who it serves."
        />
        {errors?.["descriptionMd"]?.length ? (
          <span id={`rules-description-error-${productId}`} role="alert" className="field-error">
            {errors["descriptionMd"][0]}
          </span>
        ) : (
          <span className="field-hint">Overrides the description from Square. Plain text is shown safely in paragraphs.</span>
        )}
      </label>

      <label className="flex items-center gap-2">
        {/* Unchecked checkboxes submit nothing; the hidden value makes "Hidden"
            an explicit, validated save instead of an invalid form. */}
        <input type="hidden" name="isOrderable" value="false" />
        <input
          type="checkbox"
          name="isOrderable"
          value="true"
          defaultChecked={existing?.isOrderable ?? true}
          className="accent-brand h-5 w-5"
        />
        <span className="text-ink text-sm">Available to order</span>
      </label>

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

      {result?.ok ? (
        <p role="status" className="text-success flex items-center gap-2 text-sm">
          <CheckIcon className="h-4 w-4" />
          Saved.
        </p>
      ) : result ? (
        <p role="alert" className="field-error">
          {result.error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || pickupTimes.length === 0}
          className="btn btn-primary btn-sm"
        >
          {isPending ? <span className="spinner" aria-hidden /> : null}
          {isPending ? "Saving…" : "Save rules"}
        </button>

        {/* Dirty state, so an untouched form and one with unsaved edits don't
            look identical on a page full of forms. */}
        {dirty && !isPending ? (
          <span className="text-warning text-sm">Unsaved changes</span>
        ) : null}

        {unconfigured ? (
          <span className="text-ink-subtle text-sm">
            Not sellable until these rules are saved.
          </span>
        ) : null}
      </div>
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
  const id = `rules-${name}-${useId()}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = errors?.length ? `${id}-error` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-ink text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        name={name}
        defaultValue={defaultValue}
        aria-invalid={errors ? true : undefined}
        /* Error AND hint, not one or the other. The old version swapped the hint
           out for the error, which removed the format guidance at the exact
           moment the format was wrong. */
        aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
        className="input"
      />
      {errors?.length ? (
        <span id={errorId} role="alert" className="field-error">
          {errors[0]}
        </span>
      ) : null}
      {hint ? (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
