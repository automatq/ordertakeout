import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";

import { AddToCart } from "@/components/cart/add-to-cart";
import { ProductGrid } from "@/components/product-grid";
import { ArrowLeftIcon, ClockIcon, LoafIcon, MapPinIcon } from "@/components/ui/icons";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { productImages, sizedImage } from "@/lib/catalog/images";
import { getOrderableProducts, getProductBySlug } from "@/lib/catalog/server";
import type { StoreProduct } from "@/lib/catalog/types";
import { formatPickupTime } from "@/lib/scheduling/time";

/** Next 16 passes route params as a Promise — they must be awaited. */
type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Not found" };

  const images = productImages(product);

  return {
    title: product.name,
    description: product.descriptionMd?.trim() || product.description || undefined,
    openGraph: images.length ? { images: [images[0]!] } : undefined,
  };
}

/**
 * The page shell is static; the product itself streams in.
 *
 * With Cache Components enabled, reading `params` is runtime data — touching it
 * directly in the page body would block the whole route from prerendering. Doing
 * the lookup inside <Suspense> lets the header and navigation render instantly
 * from the static shell while the catalog resolves.
 *
 * The layout is two columns from `lg`: gallery left, order panel right. It used
 * to be a single `max-w-3xl` text column with no imagery at all — the highest
 * intent page in the funnel, and the customer couldn't see the product.
 */
export default function ProductPage({ params }: PageProps) {
  return (
    <main className="shell flex flex-col gap-10 py-10 sm:py-14">
      <nav aria-label="Breadcrumb">
        <Link
          href="/#trays"
          className="text-ink-muted hover:text-brand inline-flex items-center gap-2 text-sm transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          All party trays
        </Link>
      </nav>

      <Suspense fallback={<ProductSkeleton />}>
        <ProductDetail params={params} />
      </Suspense>
    </main>
  );
}

async function ProductDetail({ params }: PageProps) {
  await connection();
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) notFound();

  return (
    <>
      <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-start">
        <Gallery product={product} />

        <div className="flex flex-col gap-6 lg:sticky lg:top-24">
          <header className="flex flex-col gap-3">
            <h1 className="font-display text-ink text-display-lg font-normal uppercase">
              {product.name}
            </h1>
            <ProductDescription product={product} />
          </header>

          {/* Above the size picker, not below it. The lead time is the single
              biggest constraint on this purchase, and customers were choosing a
              size before finding out the tray needs a day's notice. */}
          <OrderingRules product={product} />

          <AddToCart
            variants={product.variants}
            productName={product.name}
            leadTimeDays={product.rule.leadTimeDays}
            orderCutoffTime={product.rule.orderCutoffTime}
          />
        </div>
      </div>

      <Suspense fallback={null}>
        <RelatedTrays currentId={product.id} />
      </Suspense>
    </>
  );
}

/** Staff copy overrides Square copy; paragraphs stay plain text and XSS-safe. */
function ProductDescription({ product }: { product: StoreProduct }) {
  const description = product.descriptionMd?.trim() || product.description?.trim();
  if (!description) return null;

  return (
    <div className="text-ink-muted flex flex-col gap-3 text-lg text-pretty">
      {description.split(/\n\s*\n/).map((paragraph) => (
        <p key={paragraph} className="whitespace-pre-line">{paragraph}</p>
      ))}
    </div>
  );
}

function Gallery({ product }: { product: StoreProduct }) {
  const images = productImages(product);

  if (images.length === 0) {
    return (
      <div
        aria-hidden
        className="rounded-card text-brand/25 flex aspect-[4/3] w-full items-center justify-center"
        style={{
          background:
            "linear-gradient(140deg, var(--color-brand-tint) 0%, var(--color-surface-sunken) 100%)",
        }}
      >
        <LoafIcon className="h-24 w-24" />
      </div>
    );
  }

  const [hero, ...rest] = images;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-card bg-surface-sunken shadow-card relative aspect-[4/3] w-full overflow-hidden">
        <Image
          src={sizedImage(hero!, 1280)}
          alt={product.name}
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 55vw"
          className="object-cover"
        />
      </div>

      {/* Static thumbnails rather than an interactive carousel: with two or
          three photos, showing them all costs less than teaching a control. */}
      {rest.length > 0 ? (
        <ul className="grid grid-cols-4 gap-3">
          {rest.slice(0, 4).map((image, index) => (
            <li
              key={image}
              className="rounded-control bg-surface-sunken relative aspect-square overflow-hidden"
            >
              <Image
                src={sizedImage(image, 240)}
                alt={`${product.name}, view ${index + 2}`}
                fill
                sizes="120px"
                className="object-cover"
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function OrderingRules({ product }: { product: StoreProduct }) {
  const { rule } = product;
  const pickupTimes = rule.allowedPickupTimes;

  return (
    <section aria-labelledby="rules-heading" className="panel flex flex-col gap-3 p-5">
      <h2 id="rules-heading" className="text-ink font-semibold">
        How ordering works
      </h2>

      <ul className="text-ink-muted flex flex-col gap-3 text-sm">
        <li className="flex items-start gap-3">
          <ClockIcon className="text-brand mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Order at least{" "}
            <strong className="text-ink font-medium">
              {rule.leadTimeDays} day{rule.leadTimeDays === 1 ? "" : "s"}
            </strong>{" "}
            ahead, before{" "}
            <strong className="text-ink font-medium">
              {formatPickupTime(rule.orderCutoffTime)}
            </strong>
            .
          </span>
        </li>

        {pickupTimes.length > 0 ? (
          <li className="flex items-start gap-3">
            <ClockIcon className="text-brand mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Collect between{" "}
              <strong className="text-ink font-medium">
                {formatPickupTime(pickupTimes[0]!)}
              </strong>{" "}
              and{" "}
              <strong className="text-ink font-medium">
                {formatPickupTime(pickupTimes[pickupTimes.length - 1]!)}
              </strong>
              .
            </span>
          </li>
        ) : null}

        <li className="flex items-start gap-3">
          <MapPinIcon className="text-brand mt-0.5 h-4 w-4 shrink-0" />
          <span>Pay online now; collect from your selected pickup location.</span>
        </li>
      </ul>
    </section>
  );
}

/**
 * The other trays.
 *
 * A dead end here means the customer's only route onward is the back button —
 * and with three products in the catalog, showing the rest costs one already
 * cached call.
 */
async function RelatedTrays({ currentId }: { currentId: string }) {
  await connection();
  const { products } = await getOrderableProducts();
  const others = products.filter((product) => product.id !== currentId);

  if (others.length === 0) return null;

  return (
    <section aria-labelledby="related-heading" className="border-border flex flex-col gap-6 border-t pt-10">
      <h2
        id="related-heading"
        className="font-display text-ink text-display-md font-normal uppercase"
      >
        Other party trays
      </h2>
      <ProductGrid products={others} />
    </section>
  );
}

function ProductSkeleton() {
  return (
    <LoadingRegion
      label="Loading party tray"
      className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-start"
    >
      <Skeleton className="aspect-[4/3] w-full" />
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-2/3" />
        </div>
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </LoadingRegion>
  );
}
