"use client";

import { useEffect, useState } from "react";

import { getVariantAvailability } from "@/app/actions/locations";
import { variantAvailabilityBatches } from "@/lib/inventory/map";
import { usePickupLocation } from "@/lib/locations/store";
import type { StoreProduct } from "@/lib/catalog/types";

import { ProductCard } from "./product-card";

export function ProductGrid({ products }: { products: StoreProduct[] }) {
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
  return (
    <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((product) => {
        const known = availability && product.variants.every((variant) => variant.id in availability);
        const soldOut = known
          ? product.variants.every((variant) => availability[variant.id] === false)
          : false;
        return <ProductCard key={product.id} product={product} soldOut={soldOut} />;
      })}
    </div>
  );
}
