import Link from "next/link";
import { Suspense } from "react";

import { CartView } from "@/components/cart/cart-view";
import { CatalogUnavailable } from "@/components/catalog-unavailable";
import { getOrderableProducts } from "@/lib/catalog/server";

export const metadata = { title: "Your order — Party Tray Pre-Orders" };

export default function CartPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
      <nav>
        <Link href="/" className="text-ink-muted hover:text-brand text-sm transition-colors">
          &larr; Keep browsing
        </Link>
      </nav>

      <h1 className="font-display text-ink text-3xl font-semibold">Your order</h1>

      <Suspense fallback={<p className="text-ink-muted text-sm">Loading…</p>}>
        <CartBody />
      </Suspense>
    </main>
  );
}

async function CartBody() {
  const { products, error } = await getOrderableProducts();
  if (error) return <CatalogUnavailable />;
  return <CartView products={products} />;
}
