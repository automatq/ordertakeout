"use client";

import { MotionConfig, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useLayoutEffect, useState } from "react";

import { INTRO_TIMING, type IntroPhase } from "@/lib/intro/session";

/**
 * The homepage opening: an oven mouth that glows, throws flour, holds on the
 * logo, and lifts to hand off into the hero.
 *
 * The division of labour is the whole design. A blocking inline script in the
 * document head (lib/intro/session.ts) decides whether this plays and writes
 * `data-intro` on <html> before the browser paints. CSS (app/globals.css) draws
 * the curtain and runs the glow and the dust, so the opening is alive during
 * the several hundred milliseconds before this bundle lands on a slow phone.
 * This component owns only the two things that need real orchestration: the
 * logo, and the lift.
 *
 * It never decides whether to play. It reads the script's verdict off the DOM —
 * see the state initialiser for why that distinction carries so much weight.
 */

/** The curve named as --ease-curtain in app/globals.css, which the light-spill
    transition uses. Heavy to break, fast to clear: a weighted theatre curtain
    rather than a panel sliding off. */
const CURTAIN_EASE = [0.7, 0, 0.2, 1] as const;

/** The house --ease token, which Motion needs as numbers rather than a var(). */
const HOUSE_EASE = [0.2, 0.8, 0.25, 1] as const;

/** Where the logo starts, and where the CSS leaves it before hydration. Motion
    serialises this into the server-rendered style attribute, so whenever the
    bundle arrives it animates from where the pixel already is. */
const LOGO_ENTER = { opacity: 0, scale: 0.92, y: 14, filter: "blur(8px)" };
const LOGO_SETTLED = { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" };
/** The logo leaves ahead of the curtain, so it doesn't ride up like a sticker. */
const LOGO_EXIT = { opacity: 0, scale: 1.04, y: -28, filter: "blur(0px)" };

const KICKER_ENTER = { opacity: 0, letterSpacing: "0.78em" };
const KICKER_SETTLED = { opacity: 0.72, letterSpacing: "0.34em" };
const KICKER_EXIT = { opacity: 0, y: -20 };

const INSTANT = { duration: 0 } as const;

/**
 * Flour, as a frozen table.
 *
 * `Math.random()` is unavailable here twice over: it fails the prerender
 * validation that `cacheComponents` runs at build, and it would desync
 * hydration. Hand-scattered instead, kept off the centre where the logo sits.
 */
const MOTES = [
  { x: 6, y: 18, size: 3, delay: 60, dur: 6.2, sway: 9, opacity: 0.42 },
  { x: 14, y: 72, size: 2, delay: 200, dur: 5.1, sway: -7, opacity: 0.3 },
  { x: 22, y: 34, size: 4, delay: 110, dur: 7.4, sway: 12, opacity: 0.5 },
  { x: 29, y: 88, size: 2, delay: 30, dur: 4.6, sway: -10, opacity: 0.34 },
  { x: 36, y: 14, size: 3, delay: 250, dur: 6.8, sway: 8, opacity: 0.44 },
  { x: 43, y: 79, size: 2, delay: 150, dur: 5.6, sway: -6, opacity: 0.28 },
  { x: 11, y: 52, size: 2, delay: 0, dur: 6.0, sway: 11, opacity: 0.36 },
  { x: 48, y: 26, size: 2, delay: 220, dur: 7.1, sway: -9, opacity: 0.24 },
  { x: 57, y: 84, size: 3, delay: 80, dur: 5.4, sway: 7, opacity: 0.4 },
  { x: 64, y: 20, size: 2, delay: 190, dur: 6.5, sway: -12, opacity: 0.32 },
  { x: 71, y: 60, size: 4, delay: 120, dur: 4.9, sway: 10, opacity: 0.48 },
  { x: 78, y: 36, size: 2, delay: 260, dur: 7.0, sway: -8, opacity: 0.26 },
  { x: 85, y: 76, size: 3, delay: 50, dur: 5.9, sway: 9, opacity: 0.38 },
  { x: 91, y: 28, size: 2, delay: 170, dur: 6.6, sway: -11, opacity: 0.3 },
  { x: 96, y: 62, size: 3, delay: 100, dur: 5.3, sway: 6, opacity: 0.44 },
  { x: 53, y: 47, size: 2, delay: 240, dur: 7.2, sway: -5, opacity: 0.18 },
] as const;

export function IntroCurtain() {
  const prefersReducedMotion = useReducedMotion();

  /**
   * Reads the ATTRIBUTE, not sessionStorage. That is the load-bearing choice.
   *
   * Server render has no `document`, so it is always "done" — which is correct,
   * because the route is prerendered into a CDN-shared shell and the same HTML
   * goes to everyone. On a hard load the script has already decided, and this
   * agrees with it before paint. On a soft navigation to `/` the script does
   * not run at all (scripts inserted via DOM updates never execute), the
   * attribute is absent, and this component is inert — which is what we want:
   * a takeover fired at someone browsing back from the cart is hostile.
   *
   * Re-deriving from sessionStorage instead would break exactly that case. A
   * visitor whose first hard load was /products/… never ran the script, so no
   * flag was written; navigating to `/` would then set the attributes and lock
   * the scroll behind a curtain that had already been declared finished.
   */
  const [armed] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.dataset.intro === "playing",
  );

  const [phaseState, setPhase] = useState<IntroPhase>(armed ? "playing" : "done");

  /**
   * The boot script already refuses to arm under reduced motion, so this only
   * bites if the OS setting changed between that decision and hydration. Folded
   * in during render rather than pushed through an effect: an effect would
   * render the curtain once and then retract it, which is the one outcome a
   * reduced-motion user must not get.
   */
  const phase: IntroPhase = prefersReducedMotion === true ? "done" : phaseState;

  /** Set by any input. State rather than a ref because the lift duration is
      chosen during render, and React batches this with the phase change. */
  const [skipped, setSkipped] = useState(false);

  /* Keep <html> in step with the phase. This also repairs the attribute after
     React's dev-only Strict Mode remount, which resets <html> to just what it
     manages from JSX and would otherwise drop what the script set. */
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.intro = phase;
    if (phase === "lifting") root.dataset.heroReveal = "";
  }, [phase]);

  /* Teardown is deliberately a SEPARATE effect with no dependencies, so it runs
     only on unmount — never between phases. Folded into the effect above, its
     cleanup would fire on the lifting → done step and tear `data-hero-reveal`
     off the hero mid-stagger, 320ms before the reveal finishes.

     It matters beyond unmount: with `cacheComponents` a route is hidden rather
     than unmounted, and effects are cleaned up on hide. Navigating away at
     t=1.2s therefore unlocks the next route synchronously, before paint.
     Dropping `data-hero-reveal` on the way out also stops the stagger replaying
     on Back, since re-showing a `display: none` subtree restarts CSS
     animations. */
  useLayoutEffect(() => {
    return () => {
      const root = document.documentElement;
      root.dataset.intro = "done";
      delete root.dataset.heroReveal;
    };
  }, []);

  /* Hold on the settled logo, then lift. */
  useEffect(() => {
    if (phase !== "playing") return;
    const id = window.setTimeout(() => setPhase("lifting"), INTRO_TIMING.holdMs);
    return () => window.clearTimeout(id);
  }, [phase]);

  /* Any input skips. `keydown` covers Escape without special-casing it, and a
     keyboard user's first Tab both dismisses this and lands on the storefront
     skip link — the right destination, reached by the right key. */
  useEffect(() => {
    if (phase !== "playing") return;

    const skip = () => {
      setSkipped(true);
      setPhase("lifting");
    };

    const passive = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", skip, { capture: true });
    window.addEventListener("keydown", skip, passive);
    window.addEventListener("wheel", skip, passive);
    window.addEventListener("touchmove", skip, passive);

    return () => {
      window.removeEventListener("pointerdown", skip, { capture: true });
      window.removeEventListener("keydown", skip, { capture: true });
      window.removeEventListener("wheel", skip, { capture: true });
      window.removeEventListener("touchmove", skip, { capture: true });
    };
  }, [phase]);

  const liftSeconds =
    (skipped ? INTRO_TIMING.liftSkippedMs : INTRO_TIMING.liftMs) / 1000;

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        className="intro-curtain"
        aria-hidden
        /* A constant, so server and client first-render markup are identical
           and no suppressHydrationWarning is needed anywhere in here. It has to
           be `y: 0` rather than `initial={false}`: with the latter Motion would
           serialise the *animate* value, and since the server always renders
           `done`, an armed visitor's HTML would arrive already lifted. */
        initial={{ y: 0 }}
        animate={{ y: phase === "playing" ? 0 : "-100%" }}
        transition={
          phase === "lifting" && armed
            ? { duration: liftSeconds, ease: CURTAIN_EASE }
            : INSTANT
        }
        /* Never unmounted. Exiting via AnimatePresence would leave the server
           rendering a curtain that the client renders as null, and React
           recovers from that mismatch by re-rendering the whole boundary —
           which discards the inline script's corrections elsewhere in it. */
        onAnimationComplete={() => {
          if (phase === "lifting") setPhase("done");
        }}
      >
        {/* The crest, looming in the heat haze. The only crisp asset we have,
            and the blur is what lets it carry a scale the 230px lockup can't. */}
        <Image
          src="/harina/badge.png"
          alt=""
          aria-hidden
          width={256}
          height={256}
          loading="eager"
          draggable={false}
          className="intro-medallion"
        />

        <div className="intro-ember" />

        {MOTES.map((mote, index) => (
          <div
            key={index}
            className="intro-mote"
            style={
              {
                "--mote-x": `${mote.x}%`,
                "--mote-y": `${mote.y}%`,
                "--mote-size": `${mote.size}px`,
                "--mote-delay": `${mote.delay}ms`,
                "--mote-dur": `${mote.dur}s`,
                "--mote-sway": `${mote.sway}px`,
                "--mote-opacity": mote.opacity,
              } as React.CSSProperties
            }
          />
        ))}

        <div className="intro-stage">
          <motion.div
            className="intro-logo"
            initial={LOGO_ENTER}
            animate={phase === "playing" ? LOGO_SETTLED : LOGO_EXIT}
            transition={
              !armed
                ? INSTANT
                : phase === "playing"
                  ? { duration: 0.7, delay: 0.45, ease: HOUSE_EASE }
                  : { duration: 0.35, ease: "easeIn" }
            }
          >
            <Image
              src="/harina/logo.png"
              alt=""
              aria-hidden
              width={230}
              height={167}
              /* `priority` is deprecated in Next 16. Not `preload` either: the
                 docs are explicit that it must not be combined with `loading`
                 or `fetchPriority`, and recommends these two instead. No
                 `quality`, so this resolves to the same optimizer URL the site
                 header already requests and the browser serves it from cache. */
              loading="eager"
              fetchPriority="high"
              draggable={false}
              className="h-20 w-auto object-contain sm:h-28"
            />
          </motion.div>

          {/* Deliberately the same string as the hero's eyebrow pill, so the
              curtain's last frame and the hero's first frame rhyme. Live type,
              so it is the one element here that is crisp at any resolution —
              and the only one the tracking entrance is possible on at all. */}
          <motion.p
            className="intro-kicker"
            initial={KICKER_ENTER}
            animate={phase === "playing" ? KICKER_SETTLED : KICKER_EXIT}
            transition={
              !armed
                ? INSTANT
                : phase === "playing"
                  ? { duration: 0.7, delay: 0.7, ease: HOUSE_EASE }
                  : { duration: 0.3, ease: "easeIn" }
            }
          >
            Filipino Bakery &middot; Toronto
          </motion.p>
        </div>
      </motion.div>
    </MotionConfig>
  );
}
