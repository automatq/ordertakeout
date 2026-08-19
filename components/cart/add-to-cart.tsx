"use client";

import { useState } from "react";
import Link from "next/link";

import { useCart } from "@/lib/cart/store";
import type { CatalogVariant } from "@/lib/catalog/types";
import { formatMoney } from "@/lib/square/money";

/** Variant picker plus quantity, for the product page. */
export function AddToCart({ variants }: { variants: CatalogVariant[] }) {
  const { add } = useCart();
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const selected = variants.find((v) => v.id === variantId) ?? variants[0];
  if (!selected) return null;

  return (
    <div className="rounded-card border-border bg-surface flex flex-col gap-4 border p-6">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-ink-subtle mb-2 text-sm font-semibold tracking-wide uppercase">
          Choose a size
        </legend>
        <div className="flex flex-col gap-2">
          {variants.map((variant) => (
            <label
              key={variant.id}
              className={`rounded-control flex cursor-pointer items-center justify-between border px-4 py-3 transition-colors ${
                variant.id === variantId
                  ? "border-brand bg-brand-soft"
                  : "border-border hover:border-border-strong"
              }`}
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name="variant"
                  value={variant.id}
                  checked={variant.id === variantId}
                  onChange={() => {
                    setVariantId(variant.id);
                    setAdded(false);
                  }}
                  className="accent-brand"
                />
                <span className="text-ink font-medium">{variant.name}</span>
              </span>
              <span className="text-ink font-semibold">
                {formatMoney(variant.priceCents, variant.currency)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-ink-subtle text-sm font-medium">Quantity</span>
          <input
            type="number"
            min={1}
            max={50}
            value={quantity}
            onChange={(e) => {
              setQuantity(Math.max(1, Math.min(50, Number(e.target.value) || 1)));
              setAdded(false);
            }}
            className="rounded-control border-border bg-surface text-ink w-20 border px-3 py-2"
          />
        </label>

        <button
          type="button"
          onClick={() => {
            add(selected.id, quantity);
            setAdded(true);
          }}
          className="rounded-control bg-brand text-brand-ink hover:bg-brand-hover flex-1 px-5 py-2.5 font-semibold transition-colors"
        >
          Add to order &middot; {formatMoney(selected.priceCents * quantity, selected.currency)}
        </button>
      </div>

      {added ? (
        <p role="status" className="text-success text-sm">
          Added.{" "}
          <Link href="/cart" className="underline">
            View your order
          </Link>
        </p>
      ) : null}
    </div>
  );
}
