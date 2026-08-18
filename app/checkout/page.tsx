import Link from "next/link";
import { Suspense } from "react";

import { CatalogUnavailable } from "@/components/catalog-unavailable";
import { CheckoutFlow } from "@/components/checkout/checkout-flow";
import { getOrderableProducts } from "@/lib/catalog/server";
import { publicEnv } from "@/lib/env";

export const metadata = { title: "Checkout — Party Tray Pre-Orders" };

export default function CheckoutPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
      <nav>
        <Link href="/cart" className="text-ink-muted hover:text-brand text-sm transition-colors">
          &larr; Back to your order
        </Link>
      </nav>

      <h1 className="font-display text-ink text-3xl font-semibold">Checkout</h1>

      <Suspense fallback={<p className="text-ink-muted text-sm">Loading…</p>}>
        <CheckoutBody />
      </Suspense>
    </main>
  );
}

async function CheckoutBody() {
  const { products, error } = await getOrderableProducts();
  if (error) return <CatalogUnavailable />;

  const env = publicEnv();

  return (
    <CheckoutFlow
      products={products}
      squareApplicationId={env.NEXT_PUBLIC_SQUARE_APPLICATION_ID}
      squareLocationId={env.NEXT_PUBLIC_SQUARE_LOCATION_ID}
    />
  );
}
