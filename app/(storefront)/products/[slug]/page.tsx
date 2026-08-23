import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";

import { AddToCart } from "@/components/cart/add-to-cart";
import { DietaryInfo } from "@/components/catalog/dietary-info";
import { ProductGrid } from "@/components/product-grid";
import { ArrowLeftIcon, ClockIcon, LoafIcon, MapPinIcon } from "@/components/ui/icons";
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
 * The slug is resolved and `notFound()` decided in the page body, before any
 * JSX. Under Cache Components the shell streams before the page resolves, so
 * an unknown slug is HTTP 200 no matter where the check runs; Next injects
 * `<meta name="robots" content="noindex">` into the streamed not-found
 * document, which is what keeps those URLs out of search engines (see README
 * "SEO, legal pages and PWA" — a real 404 status would need a proxy.ts check).
 * Resolving in the body still buys three things: no pass-through wrapper
 * component, no gratuitous `connection()` call, and metadata + page sharing
 * one `"use cache"` lookup — so known slugs stay warm-cache fast, with
 * `loading.tsx` covering the cold path.
 *
 * The layout is two columns from `lg`: gallery left, order panel right. It used
 * to be a single `max-w-3xl` text column with no imagery at all — the highest
 * intent page in the funnel, and the customer couldn't see the product.
 */
export default async function ProductPage({ params }: PageProps) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) notFound();

  return (
    <main className="shell flex flex-col gap-12 py-8 sm:py-12 lg:gap-16 lg:py-16">
      <nav aria-label="Breadcrumb">
        <Link
          href="/#trays"
          className="border-brand/25 bg-surface text-brand hover:bg-brand hover:text-brand-ink inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-4 text-sm font-medium transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          All party trays
        </Link>
      </nav>

      <section
        aria-labelledby="product-heading"
        className="grid gap-8 lg:grid-cols-[1.08fr_0.92fr] lg:items-start lg:gap-12"
      >
        <Gallery product={product} />

        <div className="flex flex-col gap-5 lg:sticky lg:top-40">
          <header className="storefront-hero shadow-raised relative isolate flex flex-col gap-5 overflow-hidden rounded-[2.25rem] p-6 sm:p-8">
            <div aria-hidden className="storefront-hero-texture absolute inset-0 -z-10" />
            <span className="hero-badge text-brand-ink w-fit">Handcrafted for sharing</span>
            <h1
              id="product-heading"
              className="font-display text-brand-ink text-display-xl max-w-[12ch] font-normal uppercase"
            >
              {product.name}
            </h1>
            <ProductDescription product={product} inverted />
          </header>

          {/* Above the size picker, not below it. The lead time is the single
              biggest constraint on this purchase, and customers were choosing a
              size before finding out the tray needs a day's notice. */}
          <OrderingRules product={product} />

          <DietaryInfo allergens={product.allergens} dietaryTags={product.dietaryTags} />

          <AddToCart
            variants={product.variants}
            productName={product.name}
            leadTimeDays={product.rule.leadTimeDays}
            orderCutoffTime={product.rule.orderCutoffTime}
          />
        </div>
      </section>

      <Suspense fallback={null}>
        <RelatedTrays currentId={product.id} />
      </Suspense>
    </main>
  );
}

/** Staff copy overrides Square copy; paragraphs stay plain text and XSS-safe. */
function ProductDescription({
  product,
  inverted = false,
}: {
  product: StoreProduct;
  inverted?: boolean;
}) {
  const description = product.descriptionMd?.trim() || product.description?.trim();
  if (!description) return null;

  return (
    <div
      className={`flex max-w-[42rem] flex-col gap-3 text-lg leading-relaxed text-pretty ${
        inverted ? "text-brand-ink/85" : "text-ink-muted"
      }`}
    >
      {description.split(/\n\s*\n/).map((paragraph) => (
        <p key={paragraph} className="whitespace-pre-line">
          {paragraph}
        </p>
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
        className="storefront-hero-frame text-brand/25 shadow-raised flex aspect-[4/3] w-full items-center justify-center overflow-hidden"
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
    <div className="flex flex-col gap-4">
      <div className="storefront-hero-frame bg-surface-sunken shadow-raised relative aspect-[4/3] w-full overflow-hidden">
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
              className="border-surface bg-surface-sunken shadow-card relative aspect-square overflow-hidden rounded-[1.5rem] border-4"
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
    <section
      aria-labelledby="rules-heading"
      className="border-secondary/20 bg-secondary-soft flex flex-col gap-4 rounded-[2rem] border-2 p-5 sm:p-6"
    >
      <h2
        id="rules-heading"
        className="font-display text-secondary text-3xl font-normal uppercase"
      >
        How ordering works
      </h2>

      <ul className="text-ink-muted flex flex-col gap-4 text-sm leading-relaxed">
        <li className="flex items-start gap-3">
          <span className="bg-accent text-ink flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
            <ClockIcon className="h-4 w-4" />
          </span>
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
            <span className="bg-accent text-ink flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
              <ClockIcon className="h-4 w-4" />
            </span>
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
          <span className="bg-accent text-ink flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
            <MapPinIcon className="h-4 w-4" />
          </span>
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
    <section
      aria-labelledby="related-heading"
      className="border-brand/15 flex flex-col gap-8 border-t-2 pt-10 sm:pt-14"
    >
      <header className="flex flex-col gap-2">
        <p className="eyebrow text-secondary">Keep the table full</p>
        <h2
          id="related-heading"
          className="font-display text-brand text-display-md font-normal uppercase"
        >
          Other party trays
        </h2>
      </header>
      <ProductGrid products={others} />
    </section>
  );
}

