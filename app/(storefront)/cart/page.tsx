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
    <main className="shell-narrow flex flex-col gap-8 py-12 sm:py-16">
      <nav aria-label="Breadcrumb">
        <Link
          href="/#trays"
          className="text-ink-muted hover:text-brand inline-flex items-center gap-2 text-sm transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Keep browsing
        </Link>
      </nav>

      <h1 className="font-display text-ink text-display-lg font-normal uppercase">
        Your order
      </h1>

      <Suspense fallback={<ListSkeleton label="Loading your order" />}>
        <CartBody />
      </Suspense>
    </main>
  );
}

async function CartBody() {
  await connection();
  const { products, error } = await getOrderableProducts();
  if (error) return <CatalogUnavailable />;
  return <CartView products={products} />;
}
