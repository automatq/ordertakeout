"use client";

import { useEffect, useState } from "react";

import { getVariantAvailability } from "@/app/actions/locations";
import { groupByCategory } from "@/lib/catalog/categories";
import { variantAvailabilityBatches } from "@/lib/inventory/map";
import { usePickupLocation } from "@/lib/locations/store";
import type { StoreProduct } from "@/lib/catalog/types";

import { ProductCard } from "./product-card";

/**
 * `grouped` splits the grid into category sections. Off by default: the
 * homepage and the related-products rail are single runs of tiles where a
 * section header would be noise. Grouping happens inside this component rather
 * than above it so the whole page still costs one availability lookup.
 */
export function ProductGrid({
  products,
  grouped = false,
}: {
  products: StoreProduct[];
  grouped?: boolean;
}) {
  const { locationId } = usePickupLocation();
  const [state, setState] = useState<{
    locationId: string;
    availability: Record<string, boolean>;
  } | null>(null);

  useEffect(() => {
    if (!locationId) return;
    let canceled = false;
    /* Chunked because the action bounds each request. Sending the whole page in
       one call silently broke past the limit: the parse failed, availability
       came back unknown, and every product rendered as in stock. */
    const batches = variantAvailabilityBatches(
      products.flatMap((product) => product.variants.map((variant) => variant.id)),
    );

    void Promise.all(batches.map((ids) => getVariantAvailability({ locationId, variantIds: ids })))
      .then((results) => {
        if (canceled) return;
        /* One failed batch means the page's sold-out picture is incomplete.
           Showing partial availability would mark un-checked items as in stock,
           so treat it the same as knowing nothing. */
        if (results.some((result) => !result.ok)) {
          setState(null);
          return;
        }
        const availability = Object.assign(
          {},
          ...results.map((result) => (result.ok ? result.values : {})),
        ) as Record<string, boolean>;
        setState({ locationId, availability });
      })
      .catch(() => {
        // Availability is advisory on the grid; product/checkout checks remain authoritative.
      });
    return () => { canceled = true; };
  }, [locationId, products]);

  const availability = state?.locationId === locationId ? state.availability : null;

  const soldOutFor = (product: StoreProduct) => {
    const known = availability && product.variants.every((variant) => variant.id in availability);
    return known ? product.variants.every((variant) => availability[variant.id] === false) : false;
  };

  const tiles = (items: StoreProduct[]) => (
    <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((product) => (
        <ProductCard key={product.id} product={product} soldOut={soldOutFor(product)} />
      ))}
    </div>
  );

  const groups = grouped ? groupByCategory(products) : [];
  /* One section is not a section. A lone "Party Trays" header above every
     product on the page is pure noise, so fall back to a flat grid. */
  if (!grouped || groups.length < 2) return tiles(products);

  return (
    <div className="flex flex-col gap-12">
      {groups.map((group) => (
        <section
          key={group.categoryId ?? "uncategorised"}
          id={`category-${group.categoryId ?? "more"}`}
          aria-labelledby={`category-heading-${group.categoryId ?? "more"}`}
          className="scroll-mt-24"
        >
          <h3
            id={`category-heading-${group.categoryId ?? "more"}`}
            className="font-display text-ink mb-6 text-3xl font-normal uppercase"
          >
            {group.name}
          </h3>
          {tiles(group.products)}
        </section>
      ))}
    </div>
  );
}
