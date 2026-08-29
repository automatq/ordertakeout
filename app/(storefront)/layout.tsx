import { PauseBanner } from "@/components/storefront/pause-banner";
import { SiteFooter } from "@/components/storefront/site-footer";
import { SiteHeader } from "@/components/storefront/site-header";
import { LocationSelector } from "@/components/storefront/location-selector";
import { MobileStorefrontActions } from "@/components/storefront/mobile-storefront-actions";
import { Skeleton } from "@/components/ui/skeleton";
import { getStoreLocationsSafe } from "@/lib/locations/server";
import { Suspense } from "react";
import { connection } from "next/server";

/**
 * The customer-facing shell.
 *
 * A route group, so the URLs are unchanged — `/`, `/cart`, `/checkout`,
 * `/products/…`, `/orders/…` all still live at the root. What it buys is that
 * the staff routes no longer inherit this chrome: before the split they
 * rendered the bakery logo, a "Call us on…" line, a customer cart link and the
 * marketing footer around the kitchen order queue, with two sticky headers
 * stacked, and all of it printed on the prep sheets.
 */
export default function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* First tab stop on every page. `sr-only focus:not-sr-only` keeps it out
          of the layout until a keyboard user reaches it. */}
      <a
        href="#main"
        className="btn btn-primary btn-sm sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-100"
      >
        Skip to content
      </a>

      <Suspense fallback={<SiteHeaderFallback />}>
        <SiteHeader />
      </Suspense>

      <Suspense fallback={<LocationBarFallback />}>
        <LocationBar />
      </Suspense>

      <Suspense fallback={null}>
        <PauseBanner />
      </Suspense>

      <Suspense fallback={null}>
        <LiveMobileStorefrontActions />
      </Suspense>

      <div className="flex flex-1 flex-col">
        <div id="main" className="flex-1">
          {children}
        </div>

        <Suspense fallback={<SiteFooter />}>
          <LiveSiteFooter />
        </Suspense>
      </div>

    </>
  );
}

/** Keep the static storefront chrome streamable while live Square data resolves. */
async function LocationBar() {
  await connection();
  const locations = await getStoreLocationsSafe();

  return (
    <div className="bg-secondary border-secondary border-b">
      <div className="shell py-2">
        <LocationSelector compact initialLocations={locations} />
      </div>
    </div>
  );
}

async function LiveSiteFooter() {
  await connection();
  return <SiteFooter locations={await getStoreLocationsSafe()} />;
}

async function LiveMobileStorefrontActions() {
  await connection();
  return <MobileStorefrontActions locations={await getStoreLocationsSafe()} />;
}

function LocationBarFallback() {
  return (
    <div className="bg-secondary border-secondary border-b" role="status" aria-busy>
      <span className="sr-only">Loading pickup locations</span>
      <div className="shell py-2">
        <Skeleton className="h-9 w-full max-w-sm" />
      </div>
    </div>
  );
}

/** Dynamic order routes stream pathname-aware header navigation after prerendering. */
function SiteHeaderFallback() {
  return (
    <header className="bg-canvas/90 border-border shadow-sticky sticky top-0 z-50 h-[73px] border-b backdrop-blur-xl" />
  );
}
