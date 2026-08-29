import { AlertIcon, CheckIcon } from "@/components/ui/icons";
import type { CatalogReadiness } from "@/lib/catalog/readiness";
import type { SkipReason } from "@/lib/catalog/types";

/**
 * What is stopping a product the store added in Square from being sold online.
 *
 * A server component: everything here is read-only diagnosis, and the fixes all
 * happen in Square rather than in this app, so there is nothing to submit.
 */

/** Plain English plus the fix, because the audience is a baker, not a developer. */
const SKIP_COPY: Record<SkipReason, { problem: string; fix: string }> = {
  not_an_item: {
    problem: "Not a product",
    fix: "Categories and modifiers aren't sold online. No action needed.",
  },
  archived: {
    problem: "Archived in Square",
    fix: "Un-archive it in Square if it should be on sale.",
  },
  missing_name: {
    problem: "No name",
    fix: "Give the item a name in Square.",
  },
  no_sellable_variants: {
    problem: "Every size was skipped",
    fix: "Check each size has a fixed price in the store's currency.",
  },
  variation_missing_price: {
    problem: "A size has no price",
    fix: "Add a price to every size in Square.",
  },
  variation_not_fixed_price: {
    problem: "A size uses variable pricing",
    fix: "Switch it to a fixed price — variable pricing can't be charged online.",
  },
  variation_currency_mismatch: {
    problem: "A size is priced in another currency",
    fix: "Re-price it in the store's currency.",
  },
};

export function CatalogReadinessPanel({ readiness }: { readiness: CatalogReadiness }) {
  const untrackedCount = readiness.locations.reduce(
    (total, location) => total + location.untracked.length,
    0,
  );

  if (readiness.error) {
    return (
      <p role="alert" className="field-error">
        Couldn&rsquo;t read the catalog from Square, so nothing could be checked. {readiness.error}
      </p>
    );
  }

  if (readiness.skipped.length === 0 && untrackedCount === 0) {
    return (
      <p className="text-success flex items-center gap-2 text-sm">
        <CheckIcon className="h-4 w-4" />
        Every product in Square is sellable, and all of them have stock counts at every
        pickup location.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {readiness.skipped.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div>
            <h3 className="text-ink text-sm font-medium">
              In Square, but can&rsquo;t be sold online ({readiness.skipped.length})
            </h3>
            <p className="text-ink-subtle text-sm">
              These never reach the website. Each fix is made in Square, then use
              &ldquo;Sync from Square now&rdquo; above.
            </p>
          </div>

          <ul className="flex flex-col gap-2">
            {readiness.skipped.map((entry, index) => {
              const copy = SKIP_COPY[entry.reason];
              return (
                <li
                  key={entry.id ?? `${entry.reason}-${index}`}
                  className="border-border bg-surface flex flex-col gap-1 rounded-[1.25rem] border p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <AlertIcon className="text-warning h-4 w-4 shrink-0" />
                    <span className="text-ink font-medium">{entry.name ?? "Unnamed item"}</span>
                    <span className="tag text-xs">{copy.problem}</span>
                  </div>
                  <p className="text-ink-muted text-sm">{copy.fix}</p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {untrackedCount > 0 ? (
        <section className="flex flex-col gap-3">
          <div>
            <h3 className="text-ink text-sm font-medium">
              No stock count in Square ({untrackedCount})
            </h3>
            <p className="text-ink-subtle text-sm">
              A product with no inventory count reads as sold out, so it never appears at
              that location. This is different from being sold out today &mdash; these have
              never had a count set.
            </p>
          </div>

          {readiness.locations
            .filter((location) => location.untracked.length > 0)
            .map((location) => (
              <div key={location.locationId} className="flex flex-col gap-2">
                <h4 className="text-ink-subtle text-xs font-semibold tracking-[0.12em] uppercase">
                  {location.locationName}
                </h4>
                <ul className="flex flex-col gap-2">
                  {location.untracked.map((product) => (
                    <li
                      key={product.productId}
                      className="border-border bg-surface flex flex-wrap items-center gap-2 rounded-[1.25rem] border p-4"
                    >
                      <AlertIcon
                        className={`h-4 w-4 shrink-0 ${product.wholeProduct ? "text-danger" : "text-warning"}`}
                      />
                      <span className="text-ink font-medium">{product.name}</span>
                      {product.wholeProduct ? (
                        <span className="tag border-danger/30 bg-danger-soft text-danger text-xs">
                          Never appears here
                        </span>
                      ) : (
                        <span className="text-ink-muted text-sm">
                          {product.variantNames.join(", ")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </section>
      ) : null}
    </div>
  );
}
