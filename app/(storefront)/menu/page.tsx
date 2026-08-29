import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";

import { ProductGrid } from "@/components/product-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowRightIcon, ClockIcon, LoafIcon } from "@/components/ui/icons";
import { ProductGridSkeleton } from "@/components/ui/skeleton";
import { ALLERGEN_DISCLAIMER } from "@/lib/catalog/dietary";
import { getOrderableProducts } from "@/lib/catalog/server";
import { STORE_HOURS, STORE_INFO } from "@/lib/store";

export const metadata: Metadata = {
  title: "Menu",
  description: `Everything you can pre-order for pickup from ${STORE_INFO.name}, plus what we bake fresh at the counter.`,
};

/**
 * The menu, honestly split: what you can order here (the pre-order trays, from
 * the live catalog) and what you come in for (everything else). A single page
 * pretending the whole bakery is orderable online would over-promise; a page
 * with only three trays would under-sell the shop.
 */
export default function MenuPage() {
  return (
    <main className="flex flex-col">
      <section aria-labelledby="menu-heading" className="shell flex flex-col gap-8 py-10 sm:py-14">
        <header className="flex flex-col gap-3">
          <p className="eyebrow">Menu</p>
          <h1
            id="menu-heading"
            className="font-display text-brand text-display-lg max-w-[16ch] font-normal uppercase"
          >
            Order ahead, pick up fresh
          </h1>
          <p className="text-ink-muted max-w-[52ch] text-lg text-pretty">
            Everything here is baked to order — choose a pickup location and time at checkout.
            Each item lists what it contains. {ALLERGEN_DISCLAIMER}
          </p>
        </header>

        <Suspense fallback={<ProductGridSkeleton />}>
          <MenuGrid />
        </Suspense>
      </section>

      <section
        aria-labelledby="in-store-heading"
        className="bg-surface border-border border-t"
      >
        <div className="shell flex flex-col gap-5 py-12 sm:py-16">
          <p className="eyebrow">In store only</p>
          <h2
            id="in-store-heading"
            className="font-display text-ink text-display-md font-normal uppercase"
          >
            Straight from the oven
          </h2>
          <p className="text-ink-muted max-w-[52ch] text-lg text-pretty">
            Pandesal, ube pandesal, monay, shakoy, cakes and more come out of the ovens all
            day — no pre-order, just come in while they&rsquo;re warm.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/#freshly-baked" className="btn btn-primary rounded-full">
              See the bakery
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
            <span className="text-ink-subtle flex items-center gap-2 text-sm">
              <ClockIcon className="h-4 w-4" />
              Open {STORE_HOURS.opens}&ndash;{STORE_HOURS.closes}, every day
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}

async function MenuGrid() {
  await connection();
  const { products, error } = await getOrderableProducts();

  if (error || products.length === 0) {
    return (
      <EmptyState
        icon={<LoafIcon className="h-6 w-6" />}
        title="Nothing available to order right now"
        description="Please check back soon — or call the store and we'll tell you what we can bake for you."
      >
        <a href={STORE_INFO.phoneHref} className="btn btn-outline btn-sm mt-2">
          Call {STORE_INFO.phone}
        </a>
      </EmptyState>
    );
  }

  return <ProductGrid products={products} grouped />;
}
