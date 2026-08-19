import Link from "next/link";

import type { StoreProduct } from "@/lib/catalog/types";
import { lowestPriceCents } from "@/lib/catalog/map";
import { formatMoney } from "@/lib/square/money";
import { formatPickupTime } from "@/lib/scheduling/time";

/**
 * Product tile for the storefront listing.
 *
 * Imagery is optional by design — the store may not have photography yet, so the
 * card falls back to a typographic tile rather than a broken-image gap. See
 * docs/THEMING.md.
 */
export function ProductCard({ product }: { product: StoreProduct }) {
  const from = lowestPriceCents(product);
  const currency = product.variants[0]?.currency ?? "USD";
  const pickupTimes = product.rule.allowedPickupTimes;

  return (
    <Link
      href={`/products/${product.slug}`}
      className="group rounded-card border-border bg-surface shadow-card hover:shadow-raised flex flex-col overflow-hidden border transition-shadow"
    >
      {product.heroImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Square CDN URLs vary; next/image remotePatterns are configured but a plain img keeps the fallback path simple until real photography lands.
        <img
          src={product.heroImageUrl}
          alt=""
          className="bg-surface-sunken aspect-[4/3] w-full object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="bg-surface-sunken text-ink-subtle flex aspect-[4/3] w-full items-center justify-center px-6 text-center text-sm font-medium"
        >
          {product.name}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-2 p-5">
        <h2 className="text-ink group-hover:text-brand text-lg font-semibold transition-colors">
          {product.name}
        </h2>

        {product.description ? (
          <p className="text-ink-muted line-clamp-2 text-sm text-pretty">
            {product.description}
          </p>
        ) : null}

        <div className="mt-auto flex items-baseline justify-between pt-2">
          <span className="text-ink font-semibold">
            {product.variants.length > 1 ? "From " : null}
            {formatMoney(from, currency)}
          </span>
          <span className="text-ink-subtle text-xs">
            {product.variants.length} size{product.variants.length === 1 ? "" : "s"}
          </span>
        </div>

        {pickupTimes.length > 0 ? (
          <p className="text-ink-subtle text-xs">
            Pickup {formatPickupTime(pickupTimes[0]!)}
            {pickupTimes.length > 1
              ? `–${formatPickupTime(pickupTimes[pickupTimes.length - 1]!)}`
              : null}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
