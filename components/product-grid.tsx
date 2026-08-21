"use client";

import { useEffect, useState } from "react";

import { getVariantAvailability } from "@/app/actions/locations";
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
    void getVariantAvailability({
      locationId,
      variantIds: products.flatMap((product) => product.variants.map((variant) => variant.id)),
    })
      .then((result) => {
        if (canceled) return;
        setState(result.ok ? { locationId, availability: result.values } : null);
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
