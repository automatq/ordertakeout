"use client";

import Link from "next/link";

import { useCart } from "@/lib/cart/store";
import { resolveCart } from "@/lib/catalog/cart";
import type { CatalogProduct } from "@/lib/catalog/types";
import { formatMoney } from "@/lib/square/money";

export function CartView({ products }: { products: CatalogProduct[] }) {
  const { items, ready, setQuantity, remove } = useCart();

  // Avoids flashing "your order is empty" before localStorage has been read.
  if (!ready) return null;

  if (items.length === 0) {
    return (
      <p className="text-ink-muted">
        Your order is empty.{" "}
        <Link href="/" className="text-brand underline">
          Browse party trays
        </Link>
        .
      </p>
    );
  }

  const resolved = resolveCart(items, products);

  // A variant can disappear if staff archive it in Square mid-session.
  if (!resolved.ok) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="text-danger text-sm">
          Some items in your order are no longer available and have been removed.
        </p>
        <button
          type="button"
          onClick={() => resolved.unknownVariantIds.forEach(remove)}
          className="rounded-control bg-brand text-brand-ink hover:bg-brand-hover self-start px-5 py-2.5 font-semibold transition-colors"
        >
          Remove unavailable items
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col gap-3">
        {resolved.lines.map((line) => (
          <li
            key={line.variant.id}
            className="rounded-card border-border bg-surface flex items-center justify-between gap-4 border p-4"
          >
            <div className="flex flex-col">
              <span className="text-ink font-medium">{line.product.name}</span>
              <span className="text-ink-muted text-sm">{line.variant.name}</span>
              <span className="text-ink-subtle text-sm">
                {formatMoney(line.variant.priceCents, line.variant.currency)} each
              </span>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2">
                <span className="sr-only">Quantity of {line.variant.name}</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={line.quantity}
                  onChange={(e) =>
                    setQuantity(
                      line.variant.id,
                      Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                    )
                  }
                  className="rounded-control border-border bg-surface text-ink w-20 border px-3 py-2"
                />
              </label>
              <span className="text-ink w-20 text-right font-semibold">
                {formatMoney(line.lineTotalCents, line.variant.currency)}
              </span>
              <button
                type="button"
                onClick={() => remove(line.variant.id)}
                className="text-ink-subtle hover:text-danger text-sm underline transition-colors"
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-ink flex justify-between text-lg font-semibold">
        <span>Total</span>
        <span>{formatMoney(resolved.subtotalCents, resolved.currency)}</span>
      </p>

      <Link
        href="/checkout"
        className="rounded-control bg-brand text-brand-ink hover:bg-brand-hover self-start px-5 py-3 font-semibold transition-colors"
      >
        Choose pickup time
      </Link>
    </div>
  );
}
