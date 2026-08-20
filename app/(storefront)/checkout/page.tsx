import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";

import { CatalogUnavailable } from "@/components/catalog-unavailable";
import { CheckoutFlow } from "@/components/checkout/checkout-flow";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { FormSkeleton } from "@/components/ui/skeleton";
import { getOrderableProducts } from "@/lib/catalog/server";
import { publicEnv } from "@/lib/env";

export const metadata = { title: "Checkout" };

export default function CheckoutPage() {
  /* Wider than the cart: the summary sits alongside the form from `lg` up, so
     the customer can still see what they're paying for while they fill it in. */
  return (
    <main className="shell-tight flex flex-col gap-8 py-8 sm:py-12 lg:py-16">
      <nav aria-label="Breadcrumb">
        <Link
          href="/cart"
          className="text-ink-muted hover:text-brand inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-sm transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to your order
        </Link>
      </nav>

      <header className="bg-brand text-brand-ink shadow-raised relative isolate overflow-hidden rounded-[2rem] px-6 py-8 sm:rounded-[2.5rem] sm:px-10 sm:py-10">
        <span
          aria-hidden
          className="bg-accent/25 absolute -top-16 -right-12 -z-10 size-52 rounded-full blur-2xl"
        />
        <span
          aria-hidden
          className="bg-brand-hover/55 absolute -bottom-20 left-1/3 -z-10 size-56 rounded-full blur-3xl"
        />
        <div className="relative max-w-2xl">
          <p className="bg-accent text-ink mb-4 inline-flex rounded-full px-4 py-2 text-xs font-semibold tracking-[0.14em] uppercase">
            Pickup checkout
          </p>
          <h1 className="font-display text-display-lg font-normal uppercase">
            Finish your feast
          </h1>
          <p className="text-brand-ink/85 mt-3 max-w-xl text-base leading-relaxed sm:text-lg">
            Choose your pickup time, tell us who to expect, and pay securely.
          </p>
        </div>
      </header>

      <Suspense fallback={<FormSkeleton label="Loading checkout" />}>
        <CheckoutBody />
      </Suspense>
    </main>
  );
}

async function CheckoutBody() {
  await connection();
  const { products, error } = await getOrderableProducts();
  if (error) return <CatalogUnavailable />;

  const env = publicEnv();

  return (
    <CheckoutFlow
      products={products}
      squareApplicationId={env.NEXT_PUBLIC_SQUARE_APPLICATION_ID}
    />
  );
}
