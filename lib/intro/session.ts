/**
 * The homepage intro sequence, in one place.
 *
 * Two things need to agree about this animation and they run in different
 * worlds: a blocking inline <script> in the document head decides *whether* it
 * plays, and a client component decides *how*. Keeping the key and the timings
 * here means neither can drift from the other.
 *
 * Imported by app/layout.tsx (server) and components/storefront/intro (client),
 * so this module must stay isomorphic — no `server-only`, no browser globals at
 * module scope.
 */

/** Mirrors the `bakery-cart-v1` convention in lib/cart/store.ts. */
export const INTRO_STORAGE_KEY = "bakery-intro-v1";

/**
 * `data-intro` on <html>, written by the boot script and then by React.
 *
 * `playing` and `lifting` are the only two values that show the curtain; every
 * other state — including the attribute being absent entirely — leaves the page
 * visible. That direction is deliberate: no-JS, a CSP that blocks inline
 * scripts, a thrown exception and a returning visitor all fail towards "no
 * curtain" without any of them being handled explicitly.
 */
export type IntroPhase = "playing" | "lifting" | "done";

export const INTRO_TIMING = {
  /** First paint → the curtain starts to lift. Includes a 400ms hold on the
      settled logo, which is most of what makes it read cinematic. */
  holdMs: 1900,
  /** The lift itself. */
  liftMs: 600,
  /** A skipped lift. Fast enough to feel like a response, slow enough to still
      look like the curtain went up rather than blinked out. */
  liftSkippedMs: 320,
  /**
   * Backstop, owned by the boot script rather than React.
   *
   * If the route chunk 404s or hydration never lands, nothing else would ever
   * clear the curtain or release the scroll lock. This is the only part of the
   * sequence that survives the client bundle failing entirely, so it must stay
   * comfortably longer than holdMs + liftMs.
   */
  failsafeMs: 3200,
} as const;

/**
 * The boot script source, inlined into <head> by the root layout.
 *
 * It runs synchronously during HTML parsing, before the browser paints, which
 * is the whole point: the route is prerendered into a CDN-shared static shell,
 * so the curtain markup ships to *every* visitor and only a pre-paint client
 * decision can suppress it. Deferring that to an effect would show returning
 * visitors a frame of curtain.
 *
 * Kept deliberately small and dependency-free — it is parser-blocking.
 */
export function introBootScript(): string {
  const key = JSON.stringify(INTRO_STORAGE_KEY);

  return [
    // Safari private mode throws on sessionStorage. A throw must leave the
    // attribute unset, which is the same as "don't play".
    "try{if(",
    // Homepage only — the root layout wraps the staff dashboard too.
    'location.pathname==="/"',
    // A 2.5s takeover with a scroll lock is precisely what this setting opts
    // out of, so don't arm at all rather than play a "gentler" takeover.
    '&&!matchMedia("(prefers-reduced-motion: reduce)").matches',
    `&&!sessionStorage.getItem(${key})`,
    "){",
    // Claimed at arm time, not on completion, so a refresh part-way through
    // doesn't replay it.
    `sessionStorage.setItem(${key},"1");`,
    'var r=document.documentElement;r.dataset.intro="playing";',
    // Idempotent: React normally gets there first at ~2.5s, and then this is a
    // no-op. It only does real work if the client bundle never arrives.
    `setTimeout(function(){if(r.dataset.intro!=="done")r.dataset.intro="done"},${INTRO_TIMING.failsafeMs});`,
    "}}catch(e){}",
  ].join("");
}
