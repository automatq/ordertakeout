import Link from "next/link";

import { LoafIcon } from "@/components/ui/icons";
import { STORE_INFO } from "@/lib/store";

/**
 * The body of the 404 page.
 *
 * Shared between `app/not-found.tsx` (unmatched URLs, which resolve against the
 * chrome-free root layout) and `app/(storefront)/not-found.tsx` (a `notFound()`
 * thrown by a page inside the storefront group, which already has the chrome).
 * Same content, two different shells.
 */
export function NotFoundContent() {
  return (
    <main className="bg-brand px-6 py-section">
      <div className="bg-surface shadow-raised mx-auto flex max-w-2xl flex-col items-center gap-6 rounded-[2.5rem] p-8 text-center sm:p-12">
      <span
        aria-hidden
        className="bg-brand-soft text-brand flex h-20 w-20 items-center justify-center rounded-full"
      >
        <LoafIcon className="h-10 w-10" />
      </span>

      <p className="eyebrow">404</p>
      <h1 className="font-display text-brand text-display-lg font-normal uppercase">
        We couldn&rsquo;t find that page
      </h1>
      <p className="text-ink-muted max-w-md text-lg text-pretty">
        The link may be out of date, or the tray you&rsquo;re after may no longer be on
        the menu. Everything we&rsquo;re baking today is on the home page.
      </p>

      <div className="flex flex-wrap justify-center gap-3 pt-2">
        <Link href="/#trays" className="btn btn-primary">
          Browse party trays
        </Link>
        <a href={STORE_INFO.phoneHref} className="btn btn-secondary">
          Call {STORE_INFO.phone}
        </a>
      </div>
      </div>
    </main>
  );
}
