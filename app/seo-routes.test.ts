import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import manifest from "./manifest";
import robots from "./robots";
import sitemap from "./sitemap";

const mocks = vi.hoisted(() => ({
  getOrderableProducts: vi.fn(),
}));

vi.mock("@/lib/catalog/server", () => ({
  getOrderableProducts: mocks.getOrderableProducts,
}));

// These routes read process.env directly (they must survive an env-less CI
// build — see the comments in sitemap.ts/robots.ts), so the tests stub env
// rather than mocking @/lib/env.
function setEnv(squareEnvironment: string | undefined, storePublicUrl: string | undefined) {
  if (squareEnvironment === undefined) vi.stubEnv("NEXT_PUBLIC_SQUARE_ENVIRONMENT", undefined);
  else vi.stubEnv("NEXT_PUBLIC_SQUARE_ENVIRONMENT", squareEnvironment);
  if (storePublicUrl === undefined) vi.stubEnv("STORE_PUBLIC_URL", undefined);
  else vi.stubEnv("STORE_PUBLIC_URL", storePublicUrl);
}

beforeEach(() => {
  setEnv("production", "https://harinabakeshoppe.com");
  mocks.getOrderableProducts.mockReset();
  mocks.getOrderableProducts.mockResolvedValue({
    products: [{ slug: "classic-ensaymada-tray" }, { slug: "hopia-assortment" }],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("robots", () => {
  it("blocks all crawling unless the deployment is wired to production Square", () => {
    // A sandbox deployment is a staging site taking fake payments; indexing it
    // would also cannibalize the real site's search presence.
    setEnv("sandbox", "https://harinabakeshoppe.com");
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  it("keeps the transactional surfaces out of the index in production", () => {
    const result = robots();
    expect(result.rules).toMatchObject({
      allow: "/",
      disallow: ["/staff", "/api/", "/checkout", "/cart", "/account", "/orders", "/o/"],
    });
    expect(result.sitemap).toBe("https://harinabakeshoppe.com/sitemap.xml");
  });

  it("omits the sitemap reference when no public URL is configured", () => {
    setEnv("production", undefined);
    expect(robots().sitemap).toBeUndefined();
  });
});

describe("sitemap", () => {
  it("lists the storefront, policies and product pages with absolute URLs", async () => {
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).toEqual([
      "https://harinabakeshoppe.com/",
      "https://harinabakeshoppe.com/menu",
      "https://harinabakeshoppe.com/privacy",
      "https://harinabakeshoppe.com/terms",
      "https://harinabakeshoppe.com/refund-policy",
      "https://harinabakeshoppe.com/products/classic-ensaymada-tray",
      "https://harinabakeshoppe.com/products/hopia-assortment",
    ]);
  });

  it("strips a trailing slash from the configured base URL", async () => {
    setEnv("production", "https://harinabakeshoppe.com/");
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls[0]).toBe("https://harinabakeshoppe.com/");
    expect(urls[1]).toBe("https://harinabakeshoppe.com/menu");
  });

  it("is empty without a public URL and on sandbox deployments", async () => {
    setEnv("production", undefined);
    expect(await sitemap()).toEqual([]);

    setEnv("sandbox", "https://staging.example.com");
    expect(await sitemap()).toEqual([]);
  });

  it("degrades to the static entries when the catalog is unavailable", async () => {
    mocks.getOrderableProducts.mockRejectedValue(new Error("square down"));
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).toEqual([
      "https://harinabakeshoppe.com/",
      "https://harinabakeshoppe.com/menu",
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
      { src: "/harina/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/harina/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/harina/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ]);
  });

  it("ships a maskable icon so Android launchers do not clip the crest", () => {
    // The "any" icons are a circle touching the canvas edge; a squircle mask
    // crops it and leaves transparent corners.
    const maskable = manifest().icons!.filter((icon) => icon.purpose === "maskable");
    expect(maskable).toHaveLength(1);
  });

  it("keeps theme_color aligned with the viewport meta", () => {
    // These colour adjacent surfaces — address bar and installed title bar.
    // Disagreeing makes the installed app frame the page instead of continuing it.
    expect(manifest().theme_color).toBe("#f5f1e9");
  });
});
