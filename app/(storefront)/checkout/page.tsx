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
    <main className="shell-tight flex flex-col gap-8 py-12 sm:py-16">
      <nav aria-label="Breadcrumb">
        <Link
          href="/cart"
          className="text-ink-muted hover:text-brand inline-flex items-center gap-2 text-sm transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to your order
        </Link>
      </nav>

      <h1 className="font-display text-ink text-display-lg font-normal uppercase">
        Checkout
      </h1>

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
