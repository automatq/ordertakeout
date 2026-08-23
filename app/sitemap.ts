import type { MetadataRoute } from "next";

import { getOrderableProducts } from "@/lib/catalog/server";
import { publicEnv, serverEnv } from "@/lib/env";

/**
 * Absolute URLs require STORE_PUBLIC_URL; without it (local dev, previews) the
 * sitemap is empty rather than wrong. Sandbox-Square deployments are staging
 * sites and also emit nothing — robots.ts already disallows them entirely.
 * Product entries come from the cached catalog; a catalog outage degrades to
 * the static pages instead of failing the request.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = serverEnv().STORE_PUBLIC_URL?.replace(/\/$/, "");
  if (!base || publicEnv().NEXT_PUBLIC_SQUARE_ENVIRONMENT !== "production") return [];

  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/refund-policy`, changeFrequency: "yearly", priority: 0.2 },
  ];

  try {
    const { products } = await getOrderableProducts();
    for (const product of products) {
      entries.push({
        url: `${base}/products/${product.slug}`,
        changeFrequency: "weekly",
        priority: 0.8,
      });
    }
  } catch {
    // Static entries alone are still a valid sitemap.
  }

  return entries;
}
