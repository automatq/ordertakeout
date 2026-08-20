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
    <footer className="bg-surface border-border border-t print:hidden">
      <h2 className="sr-only">Site information</h2>

      <div className="shell flex flex-col gap-8 py-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-3">
            <Image
              src="/harina/logo.png"
              alt=""
              aria-hidden
              width={230}
              height={167}
              className="h-16 w-auto object-contain"
            />
            <p className="text-ink-muted text-sm text-pretty">{STORE_INFO.tagline}</p>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="font-display text-ink text-xl font-normal uppercase">Visit us</h3>
            <ul className="text-ink-muted flex flex-col gap-2 text-sm">
              {locations.map((location) => (
                <li key={location.id}>
                  <strong className="text-ink block font-medium">{location.name}</strong>
                  <address className="not-italic">{location.address}{location.city ? `, ${location.city}` : ""}</address>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="font-display text-ink text-xl font-normal uppercase">
              Get in touch
            </h3>
            <a
              href={STORE_INFO.phoneHref}
              className="text-ink-muted hover:text-brand text-sm transition-colors"
            >
              {STORE_INFO.phone}
            </a>
            <a
              href={`mailto:${STORE_INFO.email}`}
              className="text-ink-muted hover:text-brand text-sm transition-colors"
            >
              {STORE_INFO.email}
            </a>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="font-display text-ink text-xl font-normal uppercase">Orders</h3>
            <Link
              href="/#trays"
              className="text-ink-muted hover:text-brand text-sm transition-colors"
            >
              Party trays
            </Link>
            <Link
              href="/orders"
              className="text-ink-muted hover:text-brand text-sm transition-colors"
            >
              Track your order
            </Link>
            <Link
              href="/cart"
              className="text-ink-muted hover:text-brand text-sm transition-colors"
            >
              Your order
            </Link>
          </div>
        </div>

        <p className="border-border text-ink-subtle border-t pt-6 text-xs">
          &copy; {STORE_INFO.name}.
        </p>
      </div>
    </footer>
  );
}
