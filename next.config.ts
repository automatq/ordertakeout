import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Enables the `use cache` directive with cacheLife/cacheTag (Next 16's caching
   * model, replacing `unstable_cache` and route-level `revalidate`).
   *
   * The catalog is the reason: item names and prices live in Square and change
   * rarely, so they're cached for hours and invalidated on demand when staff hit
   * "re-sync" — rather than hitting the Square API on every page view.
   */
  cacheComponents: true,

  images: {
    remotePatterns: [
      // Square Catalog serves product images from its own CDN.
      { protocol: "https", hostname: "items-images-production.s3.us-west-2.amazonaws.com" },
      { protocol: "https", hostname: "square-catalog-production.s3.amazonaws.com" },
      { protocol: "https", hostname: "*.squarecdn.com" },
    ],
  },
};

export default nextConfig;
