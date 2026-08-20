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
    qualities: [75, 80],
    remotePatterns: [
      // Square Catalog serves product images from its own CDN.
      { protocol: "https", hostname: "items-images-production.s3.us-west-2.amazonaws.com" },
      { protocol: "https", hostname: "square-catalog-production.s3.amazonaws.com" },
      { protocol: "https", hostname: "*.squarecdn.com" },
    ],
  },

  async headers() {
    const production = process.env.NODE_ENV === "production";
    const contentSecurityPolicy = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"} https://web.squarecdn.com https://sandbox.web.squarecdn.com`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.squarecdn.com https://*.amazonaws.com",
      "font-src 'self' data:",
      "connect-src 'self' https://*.squareup.com https://*.squarecdn.com",
      "frame-src https://*.squareup.com https://*.squarecdn.com",
      ...(production ? ["upgrade-insecure-requests"] : []),
    ].join("; ");

    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=()" },
        ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
      ],
    }];
  },
};

export default nextConfig;
