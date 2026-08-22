# Building Without a Defined Theme

**Short answer: yes.** The visual design is the *last* thing this project needs, not the
first — and the way the app is set up, adding the real branding later is a contained
change rather than a rewrite.

This document explains how that's arranged and what to do when the branding arrives.

---

## Why this works

Almost nothing in this project is a visual decision. The hard, expensive parts — the 6:00
PM cutoff logic, pickup slot capacity, the Square Orders/Payments integration, webhook
handling, the notification fan-out — have no opinion about what colour anything is. They
are the majority of the build and they're testable without a single design asset.

The parts that *do* depend on branding are colour, type, spacing, corner radius, imagery
and logo. So we isolate exactly those into one place and leave it swappable.

## How it's arranged

Every visual value lives in the `@theme` block at the top of
[`app/globals.css`](../app/globals.css). Components never contain a hex code. They
reference semantic utilities — `bg-surface`, `text-ink-muted`, `border-border`,
`text-status-ready` — which resolve back to that block.

Two rules keep the swap cheap:

1. **Token names describe purpose, not appearance.** `--color-surface`, not
   `--color-white`. `--color-status-ready`, not a hue-specific name. A literal name becomes a
   lie the moment the brand changes, and then nobody dares touch it.

2. **Components use tokens only.** No `bg-[#8B5CF6]`, and no stock Tailwind palette
   (`slate-*`, `purple-*`) either — those aren't swappable, which defeats the point.

The current values come directly from the Harina logo: a warm cream canvas with white cards
floating on it, rust and burgundy reds for actions and confirmations, and gold for highlights
and price flags. Headings and prices are set in Bebas Neue, interface text in Poppins (both self-hosted by `next/font` in
`app/layout.tsx`, which exposes them as `--font-poppins` / `--font-bebas-neue`). The house
voice is light and tightly tracked, never heavy.

Alongside the colours, the same block defines the rest of the visual grammar:

- **A fluid display scale** — `--text-display-xl` through `--text-display-sm`, each a
  `clamp()`. Use `text-display-lg` rather than `text-4xl sm:text-5xl`; one class covers
  every breakpoint and the in-between sizes stop being guesswork. `--text-kitchen` is the
  minimum body size for staff screens read at arm's length.
- **A vertical rhythm** — `--spacing-section` (`py-section`) scales with the viewport, so
  storefront sections aren't as tall on a phone as on a desktop.
- **Layout shells** — `shell` (72rem), `shell-tight` (60rem) and `shell-narrow` (42rem)
  replace `mx-auto w-full max-w-6xl px-6`. Pick a variant; don't pair one with a Tailwind
  `max-w-*`, because custom utilities are emitted after the core ones and quietly win.
- **Named motion** — `--animate-shimmer` (skeletons), `--animate-rise` (toasts and the
  homepage hero reveal), `--animate-pulse-ring` (a new order on the queue), and
  `--animate-intro-*` (the homepage intro curtain). All are switched off in the
  `prefers-reduced-motion` block — except the intro's, which don't need to be: that block
  zeroes `animation-duration` but *not* `animation-delay`, so anything staggered has to be
  wrapped in `@media (prefers-reduced-motion: no-preference)` instead. The intro takes the
  stronger route and never renders at all for those users.
- **A print stylesheet** at the foot of the file. The prep sheet is a real deliverable, so
  it forces backgrounds on (`print-color-adjust`), darkens body ink, sets `@page` margins,
  and keeps a single order from splitting across a page break.

Two things to know before you touch it:

- **Bebas Neue ships a single 400 weight.** Anything using `font-display` must pair it with
  `font-normal` — `font-semibold`/`font-bold` makes the browser synthesise a fake bold. It's
  also condensed, so display headings sit a size step larger than you'd otherwise pick.
- **The brand hover is brighter, not darker** (`--color-brand-hover`). That lift is the
  signature of the palette; keep the direction if you retune it.

Because the tokens are semantic, a future rebrand is still just an edit to this one block.

## What we still need early (and it isn't a theme)

Two things genuinely constrain layout and are worth asking the store about now, because
they're more expensive to change later than colour is:

- **Product photography.** Whether we have good photos of the trays changes the shape of
  the product cards. We handle this by making imagery *optional* — every product card
  renders correctly with a photo and degrades to a typographic tile when there isn't one.
  So we're not blocked, but real photos will improve it a lot.

- **Rough tone.** "Warm family bakery" versus "clean modern counter service" affects type
  scale and density more than palette. A one-sentence answer is enough to proceed.

Neither is a design system. Both can be answered in a sentence.

## The handoff checklist

When the branding arrives:

1. Replace the colour values in the `@theme` block of `app/globals.css`. Keep the token
   *names* — only the values change.
2. Check contrast. `--color-ink`, `--color-ink-muted` and `--color-ink-subtle` must each
   hit 4.5:1 against `--color-canvas`; `--color-brand-ink` must hit 4.5:1 against
   `--color-brand`. `--color-ink-subtle` has the least headroom, so verify it first.
3. Swap the fonts in `app/layout.tsx` — they already come from `next/font/google`, so it's
   a change of import and of the two `variable` names the tokens point at. If the new
   display face isn't condensed, retune the `--text-display-*` clamps: those sizes assume
   Bebas's narrow set width.
4. Adjust `--radius-control` and `--radius-card` to taste — sharp corners read more
   traditional, rounder reads more modern.
5. Drop in the logo and update the placeholder copy in `app/layout.tsx` (`metadata`) and
   `components/storefront/site-header.tsx`.
6. Re-check the order status colours still read as distinct on the kitchen tablet. The
   dashboard always pairs status colour with a text label and never relies on hue alone,
   so this is a polish check rather than an accessibility risk.
7. Glance at the homepage intro curtain — the one surface in the app darker than the page.
   Its three `--color-intro-*` tokens are `color-mix()`es over `--color-ink`,
   `--color-brand-deep`, `--color-accent` and `--color-brand-hover`, so it re-tints with
   step 1 and normally needs nothing. Worth a look anyway, because it is the only place a
   new brand has to survive being lit from behind on a dark ground.

## The guarantee is enforced, not just documented

"Theme it later" only stays cheap if rules 1 and 2 above hold. The failure mode is someone
in a hurry writing `bg-[#6D4AA8]` in a handful of components — then the rebrand becomes a
hunt through the codebase instead of an edit to one file.

So it's a lint error rather than a convention. [`eslint.config.mjs`](../eslint.config.mjs)
fails the build on arbitrary colour values (`bg-[#…]`) and on stock Tailwind palette
classes (`text-purple-600`, `bg-slate-100`, …) anywhere in `app/` or `components/`:

```
error  Arbitrary colour value. Use a design token (bg-surface, text-ink, …)
       and define it in app/globals.css — see docs/THEMING.md
```

That's what turns "the rebrand will be easy" from a hope into a property of the codebase.
