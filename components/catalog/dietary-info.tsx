import {
  ALLERGEN_DISCLAIMER,
  ALLERGEN_LABELS,
  DIETARY_LABELS,
  type Allergen,
  type DietaryTag,
} from "@/lib/catalog/dietary";

/**
 * Allergen + dietary panel for the product page.
 *
 * Uses the neutral `.tag` pill (not `.badge-*`, which carries order-lifecycle
 * meaning). The disclaimer always renders when any allergen does — an allergen
 * list without "shared kitchen" next to it reads as exhaustive, which we can't
 * promise.
 */
export function DietaryInfo({
  allergens,
  dietaryTags,
}: {
  allergens: readonly Allergen[];
  dietaryTags: readonly DietaryTag[];
}) {
  if (allergens.length === 0 && dietaryTags.length === 0) return null;

  return (
    <section
      aria-labelledby="dietary-heading"
      className="border-border bg-surface flex flex-col gap-3 rounded-[2rem] border p-5 sm:p-6"
    >
      <h2 id="dietary-heading" className="font-display text-ink text-2xl font-normal uppercase">
        Allergens &amp; dietary
      </h2>

      {allergens.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-ink text-sm font-medium">Contains</h3>
          <ul className="flex flex-wrap gap-2">
            {allergens.map((allergen) => (
              <li key={allergen} className="tag">
                {ALLERGEN_LABELS[allergen]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {dietaryTags.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-ink text-sm font-medium">Good to know</h3>
          <ul className="flex flex-wrap gap-2">
            {dietaryTags.map((tag) => (
              <li key={tag} className="tag">
                {DIETARY_LABELS[tag]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-ink-subtle text-sm">{ALLERGEN_DISCLAIMER}</p>
    </section>
  );
}

/** Compact dietary-only chip row for menu and listing cards. */
export function DietaryTagChips({ dietaryTags }: { dietaryTags: readonly DietaryTag[] }) {
  if (dietaryTags.length === 0) return null;

  return (
    <ul aria-label="Dietary notes" className="flex flex-wrap gap-1.5">
      {dietaryTags.map((tag) => (
        <li key={tag} className="tag text-xs">
          {DIETARY_LABELS[tag]}
        </li>
      ))}
    </ul>
  );
}
