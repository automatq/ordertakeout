import Image from "next/image";
import Link from "next/link";

import { DietaryTagChips } from "@/components/catalog/dietary-info";
import { ArrowRightIcon, LoafIcon } from "@/components/ui/icons";
import { primaryImage, PRODUCT_BLUR_DATA_URL, sizedImage } from "@/lib/catalog/images";
import { lowestPriceCents } from "@/lib/catalog/map";
import type { StoreProduct } from "@/lib/catalog/types";
import { formatPickupTime } from "@/lib/scheduling/time";
import { formatMoney } from "@/lib/square/money";

/**
 * Product tile for the storefront listing.
 *
 * Three things changed from the original. It renders photography now that the
 * catalog resolves image URLs (lib/catalog/images.ts). It carries a visible
 * call to action, because it used to be a bare link sitting on the same page as
 * the "Picked for you" cards, which did have buttons — so the actual orderable
 * products looked less clickable than the decorative ones. And it surfaces the
 * lead time, which is the single biggest constraint on the purchase and used to
 * be invisible until the detail page.
 *
 * Imagery stays optional by design (see docs/THEMING.md): a product with no
 * photo gets a branded tile, not a broken-image gap.
 */
export function ProductCard({ product, soldOut = false }: { product: StoreProduct; soldOut?: boolean }) {
  const from = lowestPriceCents(product);
  const currency = product.variants[0]?.currency ?? "USD";
  const pickupTimes = product.rule.allowedPickupTimes;
  const image = primaryImage(product);
  const leadTimeDays = product.rule.leadTimeDays;

  return (
    <Link
      href={`/products/${product.slug}`}
      data-sold-out={soldOut}
      className="product-card-theme group card-interactive flex flex-col overflow-hidden"
    >
      <div className="product-card-image bg-surface-sunken relative aspect-[4/3] w-full overflow-hidden">
        {image ? (
          <Image
            src={sizedImage(image, 720)}
            /* Named, not decorative: for a product tile the photo IS the
               product, so an empty alt leaves a screen reader with nothing. */
            alt={product.name}
            fill
            placeholder="blur"
            blurDataURL={PRODUCT_BLUR_DATA_URL}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
          />
        ) : (
          /* Fallback tile. It no longer repeats the product name — that already
             appears in the heading directly below it — so it reads as a mark
             rather than as duplicated text. */
          <div
            aria-hidden
            className="text-brand/35 flex h-full w-full items-center justify-center"
            style={{
              background:
                "linear-gradient(140deg, var(--color-brand-tint) 0%, var(--color-surface-sunken) 100%)",
            }}
          >
            <LoafIcon className="h-16 w-16" />
          </div>
        )}

        {leadTimeDays > 0 ? (
          <span className="tag tag-accent absolute top-3 left-3 shadow-card">
            Order {leadTimeDays} day{leadTimeDays === 1 ? "" : "s"} ahead
          </span>
        ) : null}
        {soldOut ? (
          <span className="tag border-danger/30 bg-danger-soft text-danger absolute top-3 right-3 shadow-card">
            Sold out here
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          {/* h3, not h2: these sit inside a section that already has an h2. */}
          <h3 className="font-display text-ink group-hover:text-brand text-3xl font-normal uppercase transition-colors sm:text-4xl">
            {product.name}
          </h3>
          <span className="product-price-pill shrink-0">
            {product.variants.length > 1 ? <small>From</small> : null}
            <strong>{formatMoney(from, currency)}</strong>
          </span>
        </div>

        {product.descriptionMd?.trim() || product.description ? (
          <p className="text-ink-muted line-clamp-2 text-base leading-relaxed text-pretty">
            {product.descriptionMd?.trim() || product.description}
          </p>
        ) : null}

        {/* Dietary only — allergens need the shared-kitchen disclaimer beside
            them, so they stay on the detail page where it fits. */}
        <DietaryTagChips dietaryTags={product.dietaryTags} />

        {pickupTimes.length > 0 ? (
          <p className="text-ink-subtle text-xs">
            Pickup {formatPickupTime(pickupTimes[0]!)}
            {pickupTimes.length > 1
              ? `–${formatPickupTime(pickupTimes[pickupTimes.length - 1]!)}`
              : null}
          </p>
        ) : null}

        {/* Not a nested <button> — the whole card is the link. */}
        <span className="product-card-action mt-auto">
          <span>
            {soldOut ? "View other locations" : product.variants.length > 1
              ? `${product.variants.length} sizes`
              : "View tray"}
          </span>
          <ArrowRightIcon className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
        </span>
      </div>
    </Link>
  );
}
