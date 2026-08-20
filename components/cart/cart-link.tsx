"use client";

import Link from "next/link";

import { BagIcon } from "@/components/ui/icons";
import { useCart } from "@/lib/cart/store";

/**
 * The header's cart affordance.
 *
 * The count is announced politely rather than silently updating: a customer
 * using a screen reader adds a tray and hears the order size change, which is
 * the only confirmation the header can give. The visible pill stays a bare
 * number — the `sr-only` text carries the meaning so the pill doesn't have to.
 */
export function CartLink() {
  const { totalQuantity, ready } = useCart();

  // Rendered only after hydration — the server has no cart, so showing a count
  // during SSR would mismatch.
  const count = ready ? totalQuantity : 0;

  return (
    <Link
      href="/cart"
      className="text-ink hover:text-brand hover:border-brand border-border-strong bg-surface rounded-pill flex items-center gap-2 border px-3 py-2 text-sm transition-colors"
    >
      <BagIcon className="h-[1.15em] w-[1.15em]" />
      <span className="hidden sm:inline">Your order</span>

      {count > 0 ? (
        <span
          aria-hidden
          className="bg-brand text-brand-ink inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums"
        >
          {count}
        </span>
      ) : null}

      <span aria-live="polite" className="sr-only">
        {count === 0
          ? "Your order is empty"
          : `Your order, ${count} item${count === 1 ? "" : "s"}`}
      </span>
    </Link>
  );
}
