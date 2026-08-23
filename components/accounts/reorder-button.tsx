"use client";

import { useRouter } from "next/navigation";

import { useCart } from "@/lib/cart/store";

/** Restores only immutable variant IDs and quantities; price/availability re-check at checkout. */
export function ReorderButton({ items }: { items: { variantId: string; quantity: number }[] }) {
  const router = useRouter();
  const cart = useCart();
  return <button type="button" className="btn btn-primary btn-sm rounded-full" disabled={!cart.ready || !items.length} onClick={() => {
    for (const item of items) cart.add(item.variantId, item.quantity);
    router.push("/cart");
  }}>Order again</button>;
}
