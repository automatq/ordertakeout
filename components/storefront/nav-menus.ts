import { STORE_HOURS, STORE_INFO } from "@/lib/store";

/**
 * Structure for the storefront megamenu.
 *
 * Ported from the editorial nav pattern used elsewhere in the studio: each mega
 * section has a left column of numbered items with a one-line description, and a
 * right "feature card" carrying a single call to action. The house fonts do the
 * styling — Bebas Neue (`font-display`) for the headings, Poppins for the rest —
 * so the numbers use `tabular-nums` rather than a monospace face.
 *
 * Links point at `/#anchor` rather than a bare `#anchor` so they work from the
 * product, cart and checkout pages too: Next routes home and the browser scrolls,
 * with `scroll-mt-*` on the target sections keeping them clear of the sticky bar.
 */

export interface MegaMenuItem {
  /** Two-digit index shown before the title. */
  num: string;
  title: string;
  desc: string;
  href: string;
}

export interface MegaMenuFeature {
  eyebrow: string;
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
}

export interface MegaMenu {
  id: string;
  label: string;
  eyebrow: string;
  intro: string;
  items: MegaMenuItem[];
  feature: MegaMenuFeature;
}

export interface PlainNavLink {
  href: string;
  label: string;
}

const orderMenu: MegaMenu = {
  id: "order",
  label: "Order",
  eyebrow: "Section 01 / Pre-order",
  intro: "Party trays baked to order. Choose a pickup time and collect them fresh in store.",
  items: [
    {
      num: "01",
      title: "Party trays",
      desc: "Order-ahead trays for pickup. Pick your time, we bake it fresh.",
      href: "/#trays",
    },
    {
      num: "02",
      title: "Straight from the oven",
      desc: "Counter favourites baked through the day — no pre-order needed.",
      href: "/#freshly-baked",
    },
    {
      num: "03",
      title: "Track your order",
      desc: "Look up an order by number and follow it from oven to pickup.",
      href: "/orders",
    },
  ],
  feature: {
    eyebrow: "Get started",
    title: "Party trays, ready when you are.",
    body: `Order ahead and pick up in store. Open ${STORE_HOURS.opens}–${STORE_HOURS.closes}, every day.`,
    ctaLabel: "Start your order",
    ctaHref: "/#trays",
  },
};

const visitMenu: MegaMenu = {
  id: "visit",
  label: "Visit",
  eyebrow: "Section 02 / Visit us",
  intro: "Visit one of our Toronto or London bakeries for Filipino breads baked fresh daily.",
  items: [
    {
      num: "01",
      title: "Our bakery",
      desc: "Tradition and quality Filipino breads and pastries, made from scratch.",
      href: "/#freshly-baked",
    },
    {
      num: "02",
      title: "Find a store",
      desc: "Choose among our three pickup locations for hours and directions.",
      href: "/#visit",
    },
    {
      num: "03",
      title: "Call the store",
      desc: "Questions about a tray or a large order? Talk to us directly.",
      href: STORE_INFO.phoneHref,
    },
  ],
  feature: {
    eyebrow: "Come say hi",
    title: "Toronto & London",
    body: "Three pickup locations, with live branch hours and directions.",
    ctaLabel: "Get directions",
    ctaHref: "/#visit",
  },
};

export const megaMenus: MegaMenu[] = [orderMenu, visitMenu];

/** Plain links shown to the right of the megamenu triggers. */
export const plainNavLinks: PlainNavLink[] = [
  { href: "/menu", label: "Menu" },
  { href: "/orders", label: "Track order" },
];
