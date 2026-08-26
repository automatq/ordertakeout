import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";

import { CartView } from "@/components/cart/cart-view";
import { CatalogUnavailable } from "@/components/catalog-unavailable";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { ListSkeleton } from "@/components/ui/skeleton";
import { getOrderableProducts } from "@/lib/catalog/server";

export const metadata = { title: "Your order" };

export default function CartPage() {
  return (
    <main className="shell-narrow flex flex-col gap-7 py-10 sm:gap-9 sm:py-16 lg:py-20">
      <nav aria-label="Breadcrumb">
        <Link
          href="/#order"
          className="text-ink-muted hover:text-brand focus-visible:ring-brand inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Keep browsing
        </Link>
      </nav>

      <header className="mx-auto flex max-w-xl flex-col items-center gap-3 text-center">
        <p className="eyebrow font-semibold">Review your basket</p>
        <h1 className="font-display text-ink text-[clamp(3.5rem,12vw,6rem)] leading-[0.86] font-normal tracking-[-0.02em] uppercase">
          Your order
        </h1>
        <p className="text-ink-muted max-w-md text-pretty">
          Check your order, then choose a pickup time at your selected bakery.
        </p>
      </header>

      <section
        aria-label="Order summary"
        className="border-border bg-surface rounded-[2.5rem] border p-4 shadow-[var(--shadow-raised)] sm:p-8 lg:p-10"
      >
        <Suspense fallback={<ListSkeleton label="Loading your order" />}>
          <CartBody />
        </Suspense>
      </section>
    </main>
  );
}

async function CartBody() {
  await connection();
  const { products, error } = await getOrderableProducts();
  if (error) return <CatalogUnavailable />;
  return <CartView products={products} />;
}
