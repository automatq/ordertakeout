"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

import { BulkRulesPanel } from "@/components/staff/bulk-rules-panel";
import { ProductRulesForm } from "@/components/staff/product-rules-form";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchIcon } from "@/components/ui/icons";
import type { ProductRuleRow } from "@/lib/admin/queries";
import { UNCATEGORISED } from "@/lib/catalog/categories";

/**
 * The ordering-rules list.
 *
 * Every product used to render as a fully-expanded six-field form in a single
 * column, so a forty-item Square catalog was forty stacked forms with no search,
 * no filter and no way to collapse anything.
 *
 * Now each product is a `<details>` row. Unconfigured products come first and
 * open by default, because those are the ones actively costing the shop sales —
 * a product with no rules isn't sellable at all.
 */

export interface RuleListItem {
  id: string;
  name: string;
  imageUrl: string | null;
  /** Square's category, or null when the item has none. */
  categoryName: string | null;
  rule?: ProductRuleRow;
  unconfigured: boolean;
}

export function ProductRulesList({ products }: { products: RuleListItem[] }) {
  const [search, setSearch] = useState("");
  const [unconfiguredOnly, setUnconfiguredOnly] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const [category, setCategory] = useState("");

  const unconfiguredCount = products.filter((p) => p.unconfigured).length;

  /* Category is the natural unit for bulk setup — everything in "Breads" wants
     the same rule — and "Select all shown" respects the filter, so filtering
     then selecting is the whole workflow. */
  const categories = useMemo(
    () => [...new Set(products.map((product) => product.categoryName ?? UNCATEGORISED))].sort(),
    [products],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((product) => {
      if (unconfiguredOnly && !product.unconfigured) return false;
      if (category && (product.categoryName ?? UNCATEGORISED) !== category) return false;
      if (!term) return true;
      return (
        product.name.toLowerCase().includes(term) ||
        (product.rule?.slug ?? "").toLowerCase().includes(term)
      );
    });
  }, [products, search, unconfiguredOnly, category]);

  return (
    <div className="flex flex-col gap-4">
      {/* A count at the top, because "6 products are unsellable" was previously
          only discoverable by scrolling and noticing six amber badges. */}
      {unconfiguredCount > 0 ? (
        <p role="status" className="panel border-danger/30 text-ink p-4 text-sm">
          <strong className="font-semibold">
            {unconfiguredCount} product{unconfiguredCount === 1 ? "" : "s"} can&rsquo;t be
            ordered yet.
          </strong>{" "}
          They&rsquo;re in Square but have no ordering rules here, so the storefront
          doesn&rsquo;t show them. Set a lead time and pickup times to make them sellable.
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <label htmlFor="rules-search" className="text-ink-subtle text-sm font-medium">
            Find a product
          </label>
          <div className="relative">
            <SearchIcon className="text-ink-subtle pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2" />
            <input
              id="rules-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or URL name"
              className="input pl-11"
            />
          </div>
        </div>

        {categories.length > 1 ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-ink-subtle text-sm font-medium">Category</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="input"
            >
              <option value="">All categories</option>
              {categories.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
        ) : null}

        {unconfiguredCount > 0 ? (
          <label className="text-ink flex items-center gap-2 pb-3 text-sm">
            <input
              type="checkbox"
              checked={unconfiguredOnly}
              onChange={(event) => setUnconfiguredOnly(event.target.checked)}
              className="accent-brand h-5 w-5"
            />
            Needs setup only
          </label>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-pressed={bulkMode}
          onClick={() => {
            setBulkMode((on) => !on);
            setSelected(new Set());
          }}
          className={`btn btn-sm rounded-full ${bulkMode ? "btn-primary" : "btn-outline"}`}
        >
          {bulkMode ? "Done selecting" : "Set up several at once"}
        </button>

        {bulkMode ? (
          <>
            <button
              type="button"
              onClick={() => setSelected(new Set(visible.map((product) => product.id)))}
              className="btn btn-ghost btn-sm rounded-full"
            >
              Select all {visible.length} shown
            </button>
            {selected.size > 0 ? (
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="btn btn-ghost btn-sm rounded-full"
              >
                Clear selection
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {bulkMode && selected.size > 0 ? (
        <BulkRulesPanel
          productIds={[...selected]}
          onApplied={() => {
            setSelected(new Set());
            setBulkMode(false);
          }}
        />
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          compact
          title="No products match"
          description="Try a shorter search term, or clear the filter."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((product) => (
            <li key={product.id} className="panel overflow-hidden">
              {bulkMode ? (
                <label className="hover:bg-surface flex cursor-pointer items-center gap-3 p-4 transition-colors">
                  <input
                    type="checkbox"
                    checked={selected.has(product.id)}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(product.id);
                      else next.delete(product.id);
                      setSelected(next);
                    }}
                    className="accent-brand h-5 w-5 shrink-0"
                  />
                  <span className="text-ink truncate font-semibold">{product.name}</span>
                  {product.unconfigured ? (
                    <span className="badge badge-new shrink-0">Needs setup</span>
                  ) : null}
                </label>
              ) : (
              <details open={product.unconfigured} className="group">
                <summary className="hover:bg-surface flex cursor-pointer flex-wrap items-center justify-between gap-3 p-4 list-none transition-colors">
                  <span className="flex min-w-0 items-center gap-3">
                    {product.imageUrl ? (
                      <Image
                        src={product.imageUrl}
                        alt=""
                        width={48}
                        height={48}
                        className="bg-surface-sunken h-12 w-12 shrink-0 rounded-control object-cover"
                      />
                    ) : (
                      <span aria-hidden className="bg-brand-tint text-brand flex h-12 w-12 shrink-0 items-center justify-center rounded-control font-display text-xl font-normal">
                        {product.name.slice(0, 1)}
                      </span>
                    )}
                    <span className="text-ink truncate font-semibold">{product.name}</span>
                  </span>

                  <span className="flex items-center gap-2">
                    {product.unconfigured ? (
                      /* Was `badge-preparing` — gold, i.e. "in progress". This
                         is a blocking state: the product cannot be sold. */
                      <span className="badge badge-new">Needs setup</span>
                    ) : product.rule?.isOrderable ? (
                      <span className="badge badge-ready">Orderable</span>
                    ) : (
                      <span className="badge badge-completed">Hidden</span>
                    )}
                    {product.rule ? (
                      <span className="text-ink-subtle hidden text-sm sm:inline">
                        {product.rule.leadTimeDays}d ahead &middot;{" "}
                        {product.rule.allowedPickupTimes.length} pickup times
                      </span>
                    ) : null}
                    <span
                      aria-hidden
                      className="text-ink-subtle text-xs transition-transform group-open:rotate-180"
                    >
                      ▾
                    </span>
                  </span>
                </summary>

                <div className="p-4 pt-0">
                  <ProductRulesForm
                    productId={product.id}
                    productName={product.name}
                    existing={product.rule}
                    unconfigured={product.unconfigured}
                  />
                </div>
              </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
