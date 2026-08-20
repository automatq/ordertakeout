import type { CatalogProduct } from "@/lib/catalog/types";

/**
 * Stand-in for the Square catalog.
 *
 * These are the eight real SKUs and prices from the client's requirements
 * document, shaped exactly as `mapCatalogItems` would return them — so every
 * downstream path (cart resolution, pricing, scheduling, checkout) behaves
 * identically to the Square-backed one.
 *
 * The ids are prefixed `DEMO_` so a demo order is unmistakable if one ever ends
 * up in a real database.
 *
 * `imageUrls` points at the bakery's own photography in /public rather than at
 * Square's CDN — demo mode has no Square to resolve `imageIds` against, and a
 * demo that shows the real image treatment is worth more than one that shows
 * every product as a fallback tile.
 */
export const DEMO_PRODUCTS: CatalogProduct[] = [
  {
    id: "DEMO_ITEM_ENSAYMADA",
    name: "Ensaymada Party Tray",
    description:
      "Soft, buttery brioche rolls topped with cheese or ube, baked fresh for your party.",
    imageIds: [],
    imageUrls: ["/harina/ube-pandesal.webp", "/harina/freshly-baked.webp"],
    variants: [
      {
        id: "DEMO_VAR_ENSAYMADA_25_UBE",
        name: "25 pcs Ube",
        priceCents: 2500,
        currency: "CAD",
        sku: "ENS-25-UBE",
        ordinal: 0,
      },
      {
        id: "DEMO_VAR_ENSAYMADA_25_CHEESE",
        name: "25 pcs Cheese",
        priceCents: 2000,
        currency: "CAD",
        sku: "ENS-25-CHE",
        ordinal: 1,
      },
      {
        id: "DEMO_VAR_ENSAYMADA_56_UBE",
        name: "56 pcs Ube",
        priceCents: 5000,
        currency: "CAD",
        sku: "ENS-56-UBE",
        ordinal: 2,
      },
      {
        id: "DEMO_VAR_ENSAYMADA_56_CHEESE",
        name: "56 pcs Cheese",
        priceCents: 4000,
        currency: "CAD",
        sku: "ENS-56-CHE",
        ordinal: 3,
      },
    ],
  },
  {
    id: "DEMO_ITEM_HOPIA",
    name: "Hopia Ube / Hopia Baboy",
    description: "Flaky bean-filled pastries, in ube or classic baboy.",
    imageIds: [],
    imageUrls: ["/harina/hopia-pirat-baboy.webp"],
    variants: [
      {
        id: "DEMO_VAR_HOPIA_60",
        name: "60 pcs",
        priceCents: 4500,
        currency: "CAD",
        sku: "HOP-60",
        ordinal: 0,
      },
      {
        id: "DEMO_VAR_HOPIA_90",
        name: "90 pcs",
        priceCents: 6500,
        currency: "CAD",
        sku: "HOP-90",
        ordinal: 1,
      },
    ],
  },
  {
    id: "DEMO_ITEM_UBE_BARS",
    name: "Ube Bars",
    description: "Purple yam bars, rich and not too sweet.",
    imageIds: [],
    imageUrls: ["/harina/ube-bars.webp"],
    variants: [
      {
        id: "DEMO_VAR_UBE_BARS_BIG",
        name: "Big — 78 pcs",
        priceCents: 5000,
        currency: "CAD",
        sku: "UBE-78",
        ordinal: 0,
      },
      {
        id: "DEMO_VAR_UBE_BARS_SMALL",
        name: "Small — 48 pcs",
        priceCents: 3000,
        currency: "CAD",
        sku: "UBE-48",
        ordinal: 1,
      },
    ],
  },
];

/** Ordering rules to seed, matching the requirements document. */
export const DEMO_PRODUCT_RULES = [
  {
    productId: "DEMO_ITEM_ENSAYMADA",
    slug: "ensaymada-tray",
    leadTimeDays: 1,
    orderCutoffTime: "18:00",
    allowedPickupTimes: ["16:00", "17:00", "18:00", "19:00", "20:00"],
    maxUnitsPerDay: 40,
    sortOrder: 0,
  },
  {
    // Placeholder rules — the store hasn't confirmed these. See docs/SCOPE.md.
    productId: "DEMO_ITEM_HOPIA",
    slug: "hopia-tray",
    leadTimeDays: 1,
    orderCutoffTime: "18:00",
    allowedPickupTimes: ["16:00", "17:00", "18:00", "19:00", "20:00"],
    maxUnitsPerDay: 30,
    sortOrder: 1,
  },
  {
    productId: "DEMO_ITEM_UBE_BARS",
    slug: "ube-bars-tray",
    leadTimeDays: 1,
    orderCutoffTime: "18:00",
    allowedPickupTimes: ["16:00", "17:00", "18:00", "19:00", "20:00"],
    maxUnitsPerDay: 20,
    sortOrder: 2,
  },
] as const;
