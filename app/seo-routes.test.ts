import { beforeEach, describe, expect, it, vi } from "vitest";

import manifest from "./manifest";
import robots from "./robots";
import sitemap from "./sitemap";

const mocks = vi.hoisted(() => ({
  squareEnvironment: "production" as "sandbox" | "production",
  storePublicUrl: "https://harinabakeshoppe.com" as string | undefined,
  getOrderableProducts: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  publicEnv: () => ({ NEXT_PUBLIC_SQUARE_ENVIRONMENT: mocks.squareEnvironment }),
  serverEnv: () => ({ STORE_PUBLIC_URL: mocks.storePublicUrl }),
}));

vi.mock("@/lib/catalog/server", () => ({
  getOrderableProducts: mocks.getOrderableProducts,
}));

beforeEach(() => {
  mocks.squareEnvironment = "production";
  mocks.storePublicUrl = "https://harinabakeshoppe.com";
  mocks.getOrderableProducts.mockReset();
  mocks.getOrderableProducts.mockResolvedValue({
    products: [{ slug: "classic-ensaymada-tray" }, { slug: "hopia-assortment" }],
  });
});

describe("robots", () => {
  it("blocks all crawling unless the deployment is wired to production Square", () => {
    // A sandbox deployment is a staging site taking fake payments; indexing it
    // would also cannibalize the real site's search presence.
    mocks.squareEnvironment = "sandbox";
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  it("keeps the transactional surfaces out of the index in production", () => {
    const result = robots();
    expect(result.rules).toMatchObject({
      allow: "/",
      disallow: ["/staff", "/api/", "/checkout", "/cart", "/account", "/orders"],
    });
    expect(result.sitemap).toBe("https://harinabakeshoppe.com/sitemap.xml");
  });

  it("omits the sitemap reference when no public URL is configured", () => {
    mocks.storePublicUrl = undefined;
    expect(robots().sitemap).toBeUndefined();
  });
});

describe("sitemap", () => {
  it("lists the storefront, policies and product pages with absolute URLs", async () => {
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).toEqual([
      "https://harinabakeshoppe.com/",
      "https://harinabakeshoppe.com/privacy",
      "https://harinabakeshoppe.com/terms",
      "https://harinabakeshoppe.com/refund-policy",
      "https://harinabakeshoppe.com/products/classic-ensaymada-tray",
      "https://harinabakeshoppe.com/products/hopia-assortment",
    ]);
  });

  it("strips a trailing slash from the configured base URL", async () => {
    mocks.storePublicUrl = "https://harinabakeshoppe.com/";
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls[0]).toBe("https://harinabakeshoppe.com/");
    expect(urls[1]).toBe("https://harinabakeshoppe.com/privacy");
  });

  it("is empty without a public URL and on sandbox deployments", async () => {
    mocks.storePublicUrl = undefined;
    expect(await sitemap()).toEqual([]);

    mocks.storePublicUrl = "https://staging.example.com";
    mocks.squareEnvironment = "sandbox";
    expect(await sitemap()).toEqual([]);
  });

  it("degrades to the static entries when the catalog is unavailable", async () => {
    mocks.getOrderableProducts.mockRejectedValue(new Error("square down"));
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).toEqual([
      "https://harinabakeshoppe.com/",
      "https://harinabakeshoppe.com/privacy",
      "https://harinabakeshoppe.com/terms",
      "https://harinabakeshoppe.com/refund-policy",
    ]);
  });
});

describe("manifest", () => {
  it("declares an installable storefront with both icon sizes", () => {
    const result = manifest();
    expect(result.display).toBe("standalone");
    expect(result.icons).toEqual([
      { src: "/harina/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/harina/icon-512.png", sizes: "512x512", type: "image/png" },
    ]);
  });
});
