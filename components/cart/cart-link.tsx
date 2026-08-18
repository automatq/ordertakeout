"use client";

import Link from "next/link";

import { useCart } from "@/lib/cart/store";

export function CartLink() {
  const { totalQuantity, ready } = useCart();

  return (
    <Link
      href="/cart"
      className="text-ink-muted hover:text-brand flex items-center gap-2 text-sm transition-colors"
    >
      Your order
      {/* Rendered only after hydration — the server has no cart, so showing a
          count during SSR would mismatch. */}
      {ready && totalQuantity > 0 ? (
        <span className="bg-brand text-brand-ink inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold">
          {totalQuantity}
        </span>
      ) : null}
    </Link>
  );
}
