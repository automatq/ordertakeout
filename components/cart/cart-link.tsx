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
      aria-label={count === 0 ? "Your order is empty" : `Your order, ${count} item${count === 1 ? "" : "s"}`}
      className="text-ink hover:text-brand hover:border-brand border-border-strong bg-surface relative flex h-12 w-12 items-center justify-center rounded-full border shadow-card transition-colors"
    >
      <BagIcon className="h-5 w-5" />

      {count > 0 ? (
        <span
          aria-hidden
          className="bg-brand text-brand-ink absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[0.6875rem] font-semibold tabular-nums shadow-card"
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
