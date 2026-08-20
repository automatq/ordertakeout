/**
 * Store constants taken directly from the client's requirements document
 * (.context/attachments/SGX3JE/1one.pdf, summarised in docs/SCOPE.md).
 *
 * These are *defaults used to seed* `products_config`. Once seeded, the database
 * is authoritative and staff can change the rules from the admin screen without
 * a deploy. Nothing at runtime should read the ordering rules from this file.
 */

export const STORE_HOURS = {
  opens: "5:45 AM",
  closes: "9:00 PM",
  opensTime: "05:45",
  closesTime: "21:00",
} as const;

/**
 * Public-facing identity and contact details, as published on the storefront
 * (harinabakeshoppe.com). Used by the marketing homepage and the site footer.
 */
export const STORE_INFO = {
  name: "Harina Bakeshoppe",
  tagline: "Bringing the Taste of Filipino Breads to Canada",
  phone: "(647) 368-5000",
  phoneHref: "tel:+16473685000",
  email: "harinabakeshoppe@gmail.com",
  street: "314 Wilson Avenue",
  city: "North York, ON M3S 1S8",
} as const;

/** How long a pickup slot is held while the customer completes payment. */
export const SLOT_HOLD_TTL_MINUTES = 10;

/** Fallback when a slot has no `slot_capacity` override. Confirm with the store. */
export const DEFAULT_MAX_ORDERS_PER_SLOT = 5;

/** How far ahead customers may book; the UI shows the first 21 available dates. */
export const MAX_ORDER_HORIZON_DAYS = 60;

const ENSAYMADA_PICKUP_TIMES = ["16:00", "17:00", "18:00", "19:00", "20:00"] as const;

export type ProductRuleSeed = {
  slug: string;
  label: string;
  leadTimeDays: number;
  orderCutoffTime: string;
  allowedPickupTimes: readonly string[];
  /** True where the PDF states the rule outright; false where we inferred it. */
  confirmed: boolean;
};

/**
 * Ensaymada is the only product whose rules the client actually specified:
 * "one day in advance, before 6:00 PM… pickup starts at 4:00 PM the following day".
 *
 * Hopia and Ube Bars say only "please include a pickup date and pickup time
 * selection", so their rules below are a PLACEHOLDER copied from Ensaymada and
 * must be confirmed before launch — see docs/SCOPE.md "Open Items" #1. They are
 * marked `confirmed: false` so the admin screen can flag them.
 */
export const PRODUCT_RULE_SEEDS: readonly ProductRuleSeed[] = [
  {
    slug: "ensaymada-tray",
    label: "Ensaymada Party Tray",
    leadTimeDays: 1,
    orderCutoffTime: "18:00",
    allowedPickupTimes: ENSAYMADA_PICKUP_TIMES,
    confirmed: true,
  },
  {
    slug: "hopia-tray",
    label: "Hopia Ube / Hopia Baboy",
    leadTimeDays: 1,
    orderCutoffTime: "18:00",
    allowedPickupTimes: ENSAYMADA_PICKUP_TIMES,
    confirmed: false,
  },
  {
    slug: "ube-bars-tray",
    label: "Ube Bars",
    leadTimeDays: 1,
    orderCutoffTime: "18:00",
    allowedPickupTimes: ENSAYMADA_PICKUP_TIMES,
    confirmed: false,
  },
] as const;

/**
 * The eight sellable variants from the requirements document, for reference and
 * for verifying the Square Catalog sync found everything. Prices are in cents and
 * are *expected* values only — Square Catalog is the source of truth at runtime.
 */
export const EXPECTED_VARIANTS = [
  { rule: "ensaymada-tray", name: "25 pcs Ube", expectedCents: 2500 },
  { rule: "ensaymada-tray", name: "25 pcs Cheese", expectedCents: 2000 },
  { rule: "ensaymada-tray", name: "56 pcs Ube", expectedCents: 5000 },
  { rule: "ensaymada-tray", name: "56 pcs Cheese", expectedCents: 4000 },
  { rule: "hopia-tray", name: "60 pcs", expectedCents: 4500 },
  { rule: "hopia-tray", name: "90 pcs", expectedCents: 6500 },
  { rule: "ube-bars-tray", name: "Big - 78 pcs", expectedCents: 5000 },
  { rule: "ube-bars-tray", name: "Small - 48 pcs", expectedCents: 3000 },
] as const;
