import type { MetadataRoute } from "next";

import { getOrderableProducts } from "@/lib/catalog/server";

/**
 * Absolute URLs require STORE_PUBLIC_URL; without it (local dev, previews) the
 * sitemap is empty rather than wrong. Sandbox-Square deployments are staging
 * sites and also emit nothing — robots.ts already disallows them entirely.
 * Product entries come from the cached catalog; a catalog outage degrades to
 * the static pages instead of failing the request.
 *
 * Raw process.env reads, not serverEnv()/publicEnv(): metadata routes are
 * prerendered at build time, and the validators throw for ANY missing required
 * var — which would fail an env-less CI build over two vars this route doesn't
 * even use. Both vars read here are individually optional-safe.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.STORE_PUBLIC_URL?.replace(/\/$/, "");
  if (!base || process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT !== "production") return [];

  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/menu`, changeFrequency: "weekly", priority: 0.9 },
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
