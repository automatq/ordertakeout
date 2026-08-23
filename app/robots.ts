import type { MetadataRoute } from "next";

import { publicEnv, serverEnv } from "@/lib/env";

/**
 * A deployment wired to Square Sandbox is a staging site: it takes fake
 * payments and must never be indexed (it would also cannibalize the real
 * site's search presence). Only a production-Square deployment gets crawled,
 * and even there the transactional surfaces stay out of the index.
 */
export default function robots(): MetadataRoute.Robots {
  if (publicEnv().NEXT_PUBLIC_SQUARE_ENVIRONMENT !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  const base = serverEnv().STORE_PUBLIC_URL?.replace(/\/$/, "");
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/staff", "/api/", "/checkout", "/cart", "/account", "/orders"],
    },
    sitemap: base ? `${base}/sitemap.xml` : undefined,
  };
}
