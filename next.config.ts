import type { NextConfig } from "next";

import { SQUARE_PRODUCT_IMAGE_HOSTNAMES } from "./lib/catalog/image-policy";
import {
  buildContentSecurityPolicy,
  type SquareWebPaymentsEnvironment,
} from "./lib/security/content-security-policy";

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
    qualities: [75, 80],
    // Square Catalog serves product images from its own CDN and S3 buckets.
    // Query strings stay enabled because Square's image service accepts `?w=`.
    remotePatterns: SQUARE_PRODUCT_IMAGE_HOSTNAMES.map((hostname) => ({
      protocol: "https" as const,
      hostname,
      port: "",
      pathname: "/**",
    })),
  },

  async headers() {
    const production = process.env.NODE_ENV === "production";
    const squareEnvironment: SquareWebPaymentsEnvironment =
      process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox";
    const contentSecurityPolicy = buildContentSecurityPolicy({ production, squareEnvironment });

    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        // Camera is used only after a staff member explicitly opens the pickup
        // verifier; the storefront never requests it. HTTPS/localhost remains
        // required by the browser for getUserMedia.
        { key: "Permissions-Policy", value: "geolocation=(self), camera=(self), microphone=()" },
        ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
      ],
    }];
  },
};

export default nextConfig;
