import type { MetadataRoute } from "next";

/**
 * A deployment wired to Square Sandbox is a staging site: it takes fake
 * payments and must never be indexed (it would also cannibalize the real
 * site's search presence). Only a production-Square deployment gets crawled,
 * and even there the transactional surfaces stay out of the index.
 *
 * Raw process.env reads (see sitemap.ts for why): this route prerenders at
 * build time and must not trip the all-or-nothing env validators. The
 * comparison fails closed — an unset environment means "not production" and
 * disallows everything.
 */
export default function robots(): MetadataRoute.Robots {
  if (process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  const base = process.env.STORE_PUBLIC_URL?.replace(/\/$/, "");
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/staff", "/api/", "/checkout", "/cart", "/account", "/orders", "/o/"],
    },
    sitemap: base ? `${base}/sitemap.xml` : undefined,
  };
}
