import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";

import { CatalogUnavailable } from "@/components/catalog-unavailable";
import { ProductGrid } from "@/components/product-grid";
import { EmptyState } from "@/components/ui/empty-state";
import {
  ArrowRightIcon,
  ClockIcon,
  LoafIcon,
  MapPinIcon,
  PhoneIcon,
} from "@/components/ui/icons";
import { ProductGridSkeleton } from "@/components/ui/skeleton";
import { getOrderableProducts } from "@/lib/catalog/server";
import { STORE_INFO } from "@/lib/store";
import { getStoreLocationsSafe } from "@/lib/locations/server";
import { formatPickupTime } from "@/lib/scheduling/time";
import { serializeJsonLd } from "@/lib/security/serialize-json-ld";

import freshlyBakedImage from "@/public/harina/freshly-baked.webp";
import heroImage from "@/public/harina/hero.webp";
import hopiaImage from "@/public/harina/hopia-pirat-baboy.webp";
import monayImage from "@/public/harina/monay.webp";
import shakoyImage from "@/public/harina/shakoy.webp";
import ubeBarsImage from "@/public/harina/ube-bars.webp";
import ubePandesalImage from "@/public/harina/ube-pandesal.webp";

/**
 * Storefront homepage.
 *
 * Copy and photography are the bakery's own, taken from harinabakeshoppe.com.
 * The one section that is NOT static is the party tray grid: those come from
 * Square Catalog joined to the ordering rules in our database, so the store
 * edits prices in the Square Dashboard exactly as they do today.
 *
 * Two structural decisions worth keeping:
 *
 *  1. The tray grid comes second, right after the hero. It used to sit third,
 *     behind two marketing blocks, which put the only thing on this page that
 *     takes money below two screens of prose.
 *
 *  2. The catalog load is inside <Suspense>. It was awaited in the page body,
 *     so the LCP hero — static marketing content that needs no data — blocked
 *     on a Square API call and a Postgres round trip before anything painted.
 */

/** The bakery's own "Picked for you" trio, with their published photography. */
const PICKS = [
  {
    name: "Monay",
    image: monayImage,
    alt: "Freshly baked Monay from a local Filipino bakery in Toronto",
  },
  {
    name: "Ube Bars",
    image: ubeBarsImage,
    alt: "Ube Bars from a local Filipino bakery in Toronto",
  },
  {
    name: "Hopia Pirat Baboy",
    image: hopiaImage,
    alt: "Hopia Pirat Baboy from a local Filipino bakery in Toronto",
  },
] as const;

/** Customer reviews as published on the bakery's site. */
const REVIEWS = [
  {
    quote: "Bread is always fresh, and staff are all friendly and accommodating",
    name: "Philip Beloso",
  },
  {
    quote:
      "This is delicious, I finished 2 dozen haha I hope it's in my DoorDash so I can taste it again",
    name: "Bea Bonilla",
  },
  {
    quote:
      "Yes pandesal lovers, there's only one perfect pandesal for me HARINA BAKERY. Come on I love the ube bar. also that's my favourite",
    name: "Eleanor Borja",
  },
] as const;

export default function HomePage() {
  return (
    <main className="flex flex-col">
      <Suspense fallback={null}><StructuredData /></Suspense>
      <Hero />
      <Marquee />
      <PartyTraysSection />
      <PickedForYou />
      <FreshlyBaked />
      <Reviews />
      <Delivery />
      <Suspense fallback={null}><Visit /></Suspense>
    </main>
  );
}

/**
 * Local-business and review markup, so search results carry the address, hours
 * and rating rather than just a title. Rendered as JSON-LD because it describes
 * the page rather than adding anything to it.
 */
async function StructuredData() {
  await connection();
  const locations = await getStoreLocationsSafe();
  const data = {
    "@context": "https://schema.org",
    "@graph": locations.map((location) => ({
      "@type": "Bakery",
      "@id": `#${location.id}`,
      name: location.name,
      description: STORE_INFO.tagline,
      telephone: location.phone ?? STORE_INFO.phone,
      email: STORE_INFO.email,
      address: {
        "@type": "PostalAddress",
        streetAddress: location.address,
        addressLocality: location.city,
        addressCountry: "CA",
      },
      geo: location.coordinates ? {
        "@type": "GeoCoordinates",
        latitude: location.coordinates.latitude,
        longitude: location.coordinates.longitude,
      } : undefined,
      openingHoursSpecification: location.businessHours.map((period) => ({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: period.dayOfWeek,
        opens: period.startTime,
        closes: period.endTime,
      })),
      servesCuisine: "Filipino",
      review: REVIEWS.map((review) => ({
        "@type": "Review",
        author: { "@type": "Person", name: review.name },
        reviewBody: review.quote,
      })),
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}

function Hero() {
  return (
    <section id="hero" className="storefront-hero text-brand-ink relative overflow-hidden">
      <div aria-hidden className="storefront-hero-texture absolute inset-0" />

      <div className="shell relative grid items-center gap-12 py-14 sm:py-18 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16 lg:py-20">
        <div className="flex flex-col items-start gap-6">
          <div className="flex flex-wrap gap-2">
            <span className="hero-badge">Freshly baked daily</span>
            <span className="hero-badge">Toronto &amp; London</span>
          </div>

          <h1 className="font-display storefront-hero-title font-normal uppercase">
            <span className="block">Bringing the taste of</span>
            <span className="text-accent block">Filipino breads</span>
            <span className="block">to Canada</span>
          </h1>

          <p className="max-w-xl text-lg leading-relaxed text-pretty sm:text-xl lg:text-2xl">
            Discover the best in Filipino baked goods with a bakery dedicated to tradition
            and quality.
          </p>

          <div className="flex w-full flex-col gap-3 pt-2 sm:w-auto sm:flex-row">
            <Link href="#trays" className="btn hero-button-primary rounded-pill">
              Order party trays
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
            <a href={STORE_INFO.phoneHref} className="btn hero-button-secondary rounded-pill">
              <PhoneIcon className="h-4 w-4" />
              {STORE_INFO.phone}
            </a>
          </div>

          <ul className="border-brand-ink/25 flex flex-wrap gap-x-6 gap-y-2 border-t pt-5 text-sm">
            <li className="flex items-center gap-2">
              <ClockIcon className="h-4 w-4" />
              Pickup times for your selected store
            </li>
            <li className="flex items-center gap-2">
              <LoafIcon className="h-4 w-4" />
              Baked fresh to order
            </li>
            <li className="flex items-center gap-2">
              <MapPinIcon className="h-4 w-4" />
              Three pickup locations
            </li>
          </ul>
        </div>

        <div className="relative pb-12 sm:pb-14 lg:pb-10">
          <div className="storefront-hero-frame shadow-raised relative aspect-[4/3] w-full overflow-hidden lg:aspect-[6/5]">
            <Image
              src={heroImage}
              alt="Filipino breads and pastries freshly baked at Harina Bakeshoppe in Toronto"
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 55vw"
              quality={80}
              placeholder="blur"
              className="object-cover"
            />
          </div>
          <Suspense fallback={null}>
            <HeroOrderWindow />
          </Suspense>
        </div>
      </div>
    </section>
  );
}

async function HeroOrderWindow() {
  await connection();
  const { products, error } = await getOrderableProducts();
  if (error || products.length === 0) return null;

  const leadTimeDays = Math.max(...products.map((product) => product.rule.leadTimeDays));
  const cutoff = products
    .map((product) => product.rule.orderCutoffTime)
    .sort((a, b) => a.localeCompare(b))[0];
  if (!cutoff) return null;

  return (
    <div className="storefront-hero-pickup shadow-raised absolute right-4 bottom-0 left-4 flex items-center gap-3 sm:right-8 sm:left-8 lg:right-8 lg:left-8">
      <span className="storefront-hero-pickup-icon">
        <ClockIcon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-secondary text-xs font-semibold tracking-[0.12em] uppercase">
          Pickup pre-orders
        </p>
        <p className="text-ink mt-0.5 text-sm leading-snug sm:text-base">
          Order by {formatPickupTime(cutoff)} at least {leadTimeDays} day
          {leadTimeDays === 1 ? "" : "s"} ahead.
        </p>
      </div>
      <span className="tag tag-accent hidden sm:inline-flex">3 shops</span>
    </div>
  );
}

function Marquee() {
  const message = "Freshly baked • Filipino favourites • Toronto • London • Pick up in store";

  return (
    <section className="theme-marquee" aria-label={message}>
      <span className="sr-only">{message}</span>
      <div className="theme-marquee-track" aria-hidden>
        {[0, 1].map((track) => (
          <div key={track} className="theme-marquee-copy">
            <span>Freshly baked</span><i>•</i>
            <span>Filipino favourites</span><i>•</i>
            <span>Toronto</span><i>•</i>
            <span>London</span><i>•</i>
            <span>Pick up in store</span><i>•</i>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The commerce section.
 *
 * The shell — heading, lede, anchor — is static and paints immediately; only
 * the grid waits on Square and the database.
 */
function PartyTraysSection() {
  return (
    <section id="trays" data-menu-section className="bg-surface border-border scroll-mt-24 border-y">
      <div className="shell py-section">
        <SectionHeading
          eyebrow="Pre-order &amp; pickup"
          title="Party trays, ready when you are"
          lede="Order ahead, choose a location and pickup time, then collect from the store you selected."
        />
        <div aria-hidden className="mt-6 flex items-center gap-4">
          <span className="bg-brand text-brand-ink flex h-12 w-12 items-center justify-center rounded-full">
            <LoafIcon className="h-6 w-6" />
          </span>
          <span className="h-1 flex-1 rounded-full bg-[linear-gradient(90deg,var(--color-brand),var(--color-accent),transparent)]" />
        </div>

        <div className="mt-10">
          <Suspense fallback={<ProductGridSkeleton />}>
            <PartyTrayGrid />
          </Suspense>
        </div>
      </div>
    </section>
  );
}

async function PartyTrayGrid() {
  await connection();
  const { products, error } = await getOrderableProducts();

  if (error) return <CatalogUnavailable />;

  if (products.length === 0) {
    return (
      <EmptyState
        icon={<LoafIcon className="h-6 w-6" />}
        title="No trays available right now"
        description="Please check back soon — or call the store and we'll tell you what we can bake for you."
      >
        <a href={STORE_INFO.phoneHref} className="btn btn-outline btn-sm mt-2">
          Call {STORE_INFO.phone}
        </a>
      </EmptyState>
    );
  }

  return (
    <ProductGrid products={products} />
  );
}

/**
 * In-store favourites.
 *
 * These are photographs of counter items, not orderable trays. They used to
 * carry an "order now!" button that linked to the tray grid — three buttons
 * promising three specific breads and delivering a different product entirely.
 * They're framed as what they are now, with one honest route to buying them.
 */
function PickedForYou() {
  return (
    <section aria-labelledby="picks-heading" className="shell py-section">
      <SectionHeading
        id="picks-heading"
        eyebrow="In store daily"
        title="Straight from the oven"
        lede="Baked through the day and sold at the counter — no pre-order needed. Drop in and take home whatever's still warm."
      />

      <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {PICKS.map((pick) => (
          <li key={pick.name} className="card flex flex-col overflow-hidden">
            <div className="bg-surface-sunken relative aspect-[4/3] w-full">
              <Image
                src={pick.image}
                alt={pick.alt}
                fill
                placeholder="blur"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover"
              />
            </div>
            <div className="flex flex-1 items-center justify-between gap-3 p-5">
              <h3 className="font-display text-ink text-2xl font-normal uppercase">
                {pick.name}
              </h3>
              <span className="tag">At the counter</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FreshlyBaked() {
  return (
    <section
      id="freshly-baked"
      aria-labelledby="freshly-baked-heading"
      className="shell scroll-mt-24 py-section"
    >
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div className="shadow-card border-border rounded-card relative aspect-[4/3] w-full overflow-hidden border">
          <Image
            src={freshlyBakedImage}
            alt="Freshly-baked Filipino breads and pastries made daily at Harina Bakeshoppe"
            fill
            placeholder="blur"
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-cover"
          />
        </div>

        <div className="flex flex-col gap-5">
          <p className="eyebrow">Our bakery</p>
          <h2
            id="freshly-baked-heading"
            className="font-display text-ink text-display-lg font-normal uppercase"
          >
            Baked fresh, every day
          </h2>
          {/* The original ran to a hundred-plus words in a single paragraph.
              Same claims, split so they can be scanned. */}
          <p className="text-ink-muted text-lg text-pretty">
            Cakes, pies, cookies and pastries come out of our ovens through the day, so
            there&rsquo;s almost always something still warm on the shelf.
          </p>
          <ul className="text-ink-muted flex flex-col gap-2">
            <li className="flex items-start gap-3">
              <LoafIcon className="text-brand mt-1 h-4 w-4 shrink-0" />
              Traditional Filipino recipes, made the way they should be
            </li>
            <li className="flex items-start gap-3">
              <ClockIcon className="text-brand mt-1 h-4 w-4 shrink-0" />
              Batches all day &mdash; no waiting in line for the next one
            </li>
            <li className="flex items-start gap-3">
              <MapPinIcon className="text-brand mt-1 h-4 w-4 shrink-0" />
              Baked locally at our Ontario shops
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function Reviews() {
  return (
    <section
      aria-labelledby="reviews-heading"
      className="bg-surface border-border border-y"
    >
      <div className="shell py-section">
        <SectionHeading
          id="reviews-heading"
          eyebrow="Reviews"
          title="What our customers say"
        />

        <ul className="mt-10 grid gap-6 lg:grid-cols-3">
          {REVIEWS.map((review) => (
            <li
              key={review.name}
              className="rounded-card border-border bg-canvas flex flex-col gap-4 border p-6"
            >
              <span aria-hidden className="font-display text-accent text-5xl leading-none font-normal">
                &ldquo;
              </span>
              <blockquote className="text-ink flex-1 text-pretty">
                {review.quote}
              </blockquote>
              <cite className="text-ink-subtle text-sm not-italic">
                &mdash; {review.name}
              </cite>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Delivery() {
  return (
    <section aria-labelledby="delivery-heading" className="shell py-section">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <p className="eyebrow">Delivery</p>
          <h2
            id="delivery-heading"
            className="font-display text-ink text-display-lg font-normal uppercase"
          >
            Filipino treats, delivered
          </h2>
          <p className="text-ink-muted text-lg text-pretty">
            Can&rsquo;t make it in? We&rsquo;ve partnered with Uber Eats and DoorDash, so
            our breads can come to you instead. Party trays stay pickup-only &mdash; they
            travel best in your own hands.
          </p>
          {/* `.tag`, not `.badge`. The badge classes carry order-status meaning
              (green = ready, amber = preparing); a delivery partner is neither,
              and reusing them made the status colours ambiguous. */}
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="tag">Uber Eats</span>
            <span className="tag">DoorDash</span>
          </div>
        </div>

        <div className="shadow-card border-border rounded-card relative aspect-[4/3] w-full overflow-hidden border lg:order-first">
          <Image
            src={ubePandesalImage}
            alt="Ube pandesal from Harina Bakeshoppe, available for delivery"
            fill
            placeholder="blur"
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-cover"
          />
        </div>
      </div>
    </section>
  );
}

/**
 * Where to find the store.
 *
 * `STORE_INFO` has carried the address all along but only the footer ever used
 * it, so a customer collecting a pre-order had no map, no hours and no
 * directions anywhere on the page they were ordering from.
 */
async function Visit() {
  await connection();
  const locations = await getStoreLocationsSafe();

  return (
    <section
      id="visit"
      aria-labelledby="visit-heading"
      className="bg-surface border-border scroll-mt-24 border-y"
    >
      <div className="shell grid items-center gap-12 py-section lg:grid-cols-2">
        <div className="shadow-card border-border rounded-card relative aspect-square w-full overflow-hidden border">
          <Image
            src={shakoyImage}
            alt="Shakoy twists on the counter at Harina Bakeshoppe"
            fill
            placeholder="blur"
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-cover"
          />
        </div>

        <div className="flex flex-col gap-5">
          <p className="eyebrow">Visit us</p>
          <h2
            id="visit-heading"
            className="font-display text-ink text-display-lg font-normal uppercase"
          >
            Come and collect
          </h2>

          <ul className="flex flex-col gap-3">
            {locations.map((location) => {
              const mapsQuery = encodeURIComponent(`${location.address}, ${location.city ?? ""}`);
              return (
                <li key={location.id} className="panel flex flex-col gap-2 p-4">
                  <strong className="text-ink">{location.name}</strong>
                  <address className="text-ink-muted text-sm not-italic">{location.address}{location.city ? `, ${location.city}` : ""}</address>
                  <p className="text-ink-subtle text-sm">
                    <ClockIcon className="mr-1.5 inline h-4 w-4" />
                    {businessHoursLabel(location.businessHours)}
                  </p>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <a href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`} target="_blank" rel="noreferrer" className="link inline-flex min-h-11 items-center">Directions</a>
                    {location.phone ? <a href={`tel:${location.phone.replace(/[^+\d]/g, "")}`} className="link inline-flex min-h-11 items-center">{location.phone}</a> : null}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap gap-3 pt-1">
            <Link href="#trays" className="btn btn-outline">
              Order a tray
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function businessHoursLabel(
  periods: { dayOfWeek: string; startTime: string; endTime: string }[],
): string {
  if (periods.length === 0) return "Call for today’s hours";

  const first = periods[0];
  const sameHours = first
    ? periods.every(
        (period) =>
          period.startTime === first.startTime && period.endTime === first.endTime,
      )
    : false;

  if (first && sameHours && periods.length === 7) {
    return `Daily ${formatBusinessTime(first.startTime)}–${formatBusinessTime(first.endTime)}`;
  }

  const todayCode = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][new Date().getDay()];
  const today = periods.find((period) => period.dayOfWeek === todayCode) ?? first;
  return today
    ? `Today ${formatBusinessTime(today.startTime)}–${formatBusinessTime(today.endTime)}`
    : "Call for today’s hours";
}

function formatBusinessTime(value: string): string {
  const [hourPart = "0", minute = "00"] = value.split(":");
  const hour = Number(hourPart);
  const suffix = hour >= 12 ? "pm" : "am";
  const displayHour = hour % 12 || 12;
  return minute === "00" ? `${displayHour}${suffix}` : `${displayHour}:${minute}${suffix}`;
}

function SectionHeading({
  id,
  eyebrow,
  title,
  lede,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  lede?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="eyebrow">{eyebrow}</p>
      <h2
        id={id}
        className="font-display text-ink text-display-lg font-normal uppercase"
      >
        {title}
      </h2>
      {lede ? (
        <p className="text-ink-muted max-w-2xl text-lg text-pretty">{lede}</p>
      ) : null}
    </div>
  );
}
