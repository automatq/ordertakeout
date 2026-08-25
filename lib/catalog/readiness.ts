import "server-only";

import { fetchTrackedVariationIds } from "@/lib/inventory/server";
import { getStoreLocationsSafe } from "@/lib/locations/server";
import { reportError } from "@/lib/monitoring/report";

import { getOrderableProducts } from "./server";
import type { SkipReason } from "./types";

/**
 * Why a product the store added in Square isn't sellable online.
 *
 * The bakery fills its own catalog in Square, so the two ways a product goes
 * quietly missing are both theirs to fix and neither was visible anywhere:
 *
 *  - The mapper drops it (variable pricing, no price, archived). `catalog.skipped`
 *    has carried the reason all along and nothing ever rendered it.
 *  - Square holds no inventory record for it at a branch. A missing count reads
 *    as sold out by design, so the product silently never appears there.
 *
 * With three trays somebody notices. With sixty items added over weeks nobody
 * does, and it arrives as "the website is broken".
 */

/** Square objects that are legitimately not products — categories, modifiers. */
const EXPECTED_SKIPS: ReadonlySet<SkipReason> = new Set(["not_an_item"]);

export interface SkippedProduct {
  id: string | null;
  name: string | null;
  reason: SkipReason;
}

export interface UntrackedProduct {
  productId: string;
  name: string;
  /** Variants Square holds no inventory record for. Empty is impossible here. */
  variantNames: string[];
  /** True when no variant is tracked, so the product never appears at all. */
  wholeProduct: boolean;
}

export interface LocationReadiness {
  locationId: string;
  locationName: string;
  untracked: UntrackedProduct[];
}

export interface CatalogReadiness {
  skipped: SkippedProduct[];
  locations: LocationReadiness[];
  /** Set when the catalog itself could not be read; the panel says so plainly. */
  error?: string;
}

/** Square caps ids per batchGetCounts request; the diagnostic sends the whole catalog. */
const COUNT_REQUEST_LIMIT = 500;

export async function getCatalogReadiness(): Promise<CatalogReadiness> {
  const catalog = await getOrderableProducts();
  const skipped = catalog.skipped.filter((entry) => !EXPECTED_SKIPS.has(entry.reason));

  if (catalog.error) return { skipped, locations: [], error: catalog.error };
  if (catalog.products.length === 0) return { skipped, locations: [] };

  const variantIds = catalog.products.flatMap((product) =>
    product.variants.map((variant) => variant.id),
  );

  const locations = await getStoreLocationsSafe();
  const readiness: LocationReadiness[] = [];

  for (const location of locations) {
    try {
      const tracked = new Set<string>();
      for (let start = 0; start < variantIds.length; start += COUNT_REQUEST_LIMIT) {
        const batch = variantIds.slice(start, start + COUNT_REQUEST_LIMIT);
        for (const id of await fetchTrackedVariationIds(location.id, batch)) tracked.add(id);
      }

      const untracked: UntrackedProduct[] = [];
      for (const product of catalog.products) {
        const missing = product.variants.filter((variant) => !tracked.has(variant.id));
        if (missing.length === 0) continue;
        untracked.push({
          productId: product.id,
          name: product.name,
          variantNames: missing.map((variant) => variant.name),
          wholeProduct: missing.length === product.variants.length,
        });
      }

      readiness.push({ locationId: location.id, locationName: location.name, untracked });
    } catch (cause) {
      /* One branch failing must not hide the others. A missing entry reads as
         "not checked" in the panel rather than "all good". */
      reportError("catalog", `inventory readiness check failed for ${location.id}`, cause);
    }
  }

  return { skipped, locations: readiness };
}
