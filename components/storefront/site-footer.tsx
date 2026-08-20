import Image from "next/image";
import Link from "next/link";

import { STORE_INFO } from "@/lib/store";
import type { StoreLocation } from "@/lib/locations/types";

/**
 * Site footer.
 *
 * The headings here were `<h2>`, which put them at the same level as page
 * content on every route and broke the document outline; they're `<h3>` under a
 * visually-hidden `<h2>` now.
 *
 * "Track your order" lives here because it's otherwise unreachable — the order
 * URL used to be the only way back to an order, so closing the tab lost it.
 */
export function SiteFooter({ locations = [] }: { locations?: StoreLocation[] }) {
  return (
    <footer className="bg-ink text-canvas border-ink border-t print:hidden">
      <h2 className="sr-only">Site information</h2>

      <div className="shell flex flex-col gap-10 py-14 sm:py-18">
        <div className="flex flex-col items-center text-center">
          <div className="bg-canvas/5 border-canvas/10 flex h-24 w-24 items-center justify-center rounded-full border">
            <Image
              src="/harina/badge.png"
              alt=""
              aria-hidden
              width={96}
              height={96}
              className="h-20 w-20 object-contain"
            />
          </div>
          <p className="font-display mt-5 text-5xl font-normal uppercase sm:text-6xl">{STORE_INFO.name}</p>
          <p className="text-accent mt-2 text-sm font-medium tracking-[0.16em] uppercase">{STORE_INFO.tagline}</p>
        </div>

        <div className="border-canvas/15 grid gap-4 border-y py-8 md:grid-cols-3">
          <div className="bg-canvas/5 border-canvas/10 flex flex-col gap-3 rounded-[1.5rem] border p-5">
            <h3 className="font-display text-accent text-2xl font-normal uppercase">Visit us</h3>
            <ul className="text-canvas/75 flex flex-col gap-4 text-sm">
              {locations.map((location) => (
                <li key={location.id}>
                  <strong className="text-canvas block font-medium">{location.name}</strong>
                  <address className="mt-0.5 not-italic">{location.address}{location.city ? `, ${location.city}` : ""}</address>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-canvas/5 border-canvas/10 flex flex-col gap-2 rounded-[1.5rem] border p-5">
            <h3 className="font-display text-accent text-2xl font-normal uppercase">
              Get in touch
            </h3>
            <a
              href={STORE_INFO.phoneHref}
              className="text-canvas/75 hover:text-accent flex min-h-11 items-center text-sm transition-colors"
            >
              {STORE_INFO.phone}
            </a>
            <a
              href={`mailto:${STORE_INFO.email}`}
              className="text-canvas/75 hover:text-accent flex min-h-11 items-center text-sm transition-colors"
            >
              {STORE_INFO.email}
            </a>
          </div>

          <div className="bg-canvas/5 border-canvas/10 flex flex-col gap-2 rounded-[1.5rem] border p-5">
            <h3 className="font-display text-accent text-2xl font-normal uppercase">Orders</h3>
            <Link
              href="/#trays"
              className="text-canvas/75 hover:text-accent flex min-h-11 items-center text-sm transition-colors"
            >
              Party trays
            </Link>
            <Link
              href="/orders"
              className="text-canvas/75 hover:text-accent flex min-h-11 items-center text-sm transition-colors"
            >
              Track your order
            </Link>
            <Link
              href="/cart"
              className="text-canvas/75 hover:text-accent flex min-h-11 items-center text-sm transition-colors"
            >
              Your order
            </Link>
          </div>
        </div>

        <p className="text-canvas/55 text-center text-xs">
          &copy; {STORE_INFO.name}. Baked with care in Ontario.
        </p>
      </div>
    </footer>
  );
}
