import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AddToCart } from "@/components/cart/add-to-cart";
import { getProductBySlug } from "@/lib/catalog/server";
import { formatPickupTime } from "@/lib/scheduling/time";

/** Next 16 passes route params as a Promise — they must be awaited. */
type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Not found" };

  return {
    title: `${product.name} — Party Tray Pre-Orders`,
    description: product.description ?? undefined,
  };
}

/**
 * The page shell is static; the product itself streams in.
 *
 * With Cache Components enabled, reading `params` is runtime data — touching it
 * directly in the page body would block the whole route from prerendering. Doing
 * the lookup inside <Suspense> lets the header and navigation render instantly
 * from the static shell while the catalog resolves.
 */
export default function ProductPage({ params }: PageProps) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
      <nav>
        <Link href="/" className="text-ink-muted hover:text-brand text-sm transition-colors">
          &larr; All party trays
        </Link>
      </nav>

      <Suspense fallback={<ProductSkeleton />}>
        <ProductDetail params={params} />
      </Suspense>
    </main>
  );
}

async function ProductDetail({ params }: PageProps) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) notFound();

  const { rule } = product;
  const pickupTimes = rule.allowedPickupTimes;

  return (
    <>
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-ink text-3xl font-semibold text-balance">
          {product.name}
        </h1>
        {product.description ? (
          <p className="text-ink-muted text-lg text-pretty">{product.description}</p>
        ) : null}
      </header>

      <AddToCart variants={product.variants} />

      <section
        aria-label="Ordering requirements"
        className="rounded-card border-border bg-surface-sunken flex flex-col gap-2 border p-6"
      >
        <h2 className="text-ink font-semibold">How ordering works</h2>
        <ul className="text-ink-muted flex list-disc flex-col gap-1 pl-5 text-sm">
          <li>
            Order at least{" "}
            <strong className="text-ink font-medium">
              {rule.leadTimeDays} day{rule.leadTimeDays === 1 ? "" : "s"}
            </strong>{" "}
            in advance, before{" "}
            <strong className="text-ink font-medium">
              {formatPickupTime(rule.orderCutoffTime)}
            </strong>
            .
          </li>
          {pickupTimes.length > 0 ? (
            <li>
              Pickup times:{" "}
              <strong className="text-ink font-medium">
                {pickupTimes.map(formatPickupTime).join(", ")}
              </strong>
              .
            </li>
          ) : null}
          <li>Pay online when you order; collect in store at your chosen time.</li>
        </ul>
      </section>
    </>
  );
}

function ProductSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-8" aria-hidden>
      <div className="flex flex-col gap-3">
        <div className="bg-surface-sunken h-9 w-2/3 rounded" />
        <div className="bg-surface-sunken h-6 w-full rounded" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="bg-surface-sunken h-12 w-full rounded" />
        <div className="bg-surface-sunken h-12 w-full rounded" />
      </div>
      <div className="bg-surface-sunken h-40 w-full rounded" />
    </div>
  );
}
