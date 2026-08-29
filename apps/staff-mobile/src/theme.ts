import { tokens } from "./tokens.generated";

/**
 * The app's colours, from the web's design tokens.
 *
 * `tokens.generated.ts` is written by scripts/generate-app-theme.mjs out of
 * app/globals.css, which stays the single source of truth. This file only
 * gives the ones this app uses shorter names and adds what is genuinely
 * app-specific.
 *
 * These were hand-copied at first and drifted within a day — the brand red was
 * #9E3136 here and #ce3f23 on the web, with a green and an amber that appear
 * nowhere in the palette. Nothing looked broken, which is exactly how that
 * fails. CI now regenerates and diffs, so a palette change that forgets the
 * apps cannot merge.
 */
export const theme = {
  canvas: tokens.canvas,
  surface: tokens.surface,
  surfaceSunken: tokens.surfaceSunken,
  brand: tokens.brand,
  brandInk: tokens.brandInk,
  ink: tokens.ink,
  inkMuted: tokens.inkMuted,
  inkSubtle: tokens.inkSubtle,
  border: tokens.border,
  danger: tokens.danger,
  dangerSoft: tokens.dangerSoft,
  ok: tokens.success,
  okSurface: tokens.statusReadySoft,
  warn: tokens.warning,
  warnSurface: tokens.statusPreparingSoft,
} as const;

/**
 * Order status, in the words staff use.
 *
 * Colours come from the shared status tokens, so the pill on a counter tablet
 * is the same colour as the badge on the dashboard — staff move between the
 * two all shift and a mismatch reads as two different systems.
 */
export const statusStyle: Record<string, { label: string; bg: string; fg: string }> = {
  paid: { label: "New", bg: tokens.statusNewSoft, fg: tokens.statusNew },
  preparing: { label: "Preparing", bg: tokens.statusPreparingSoft, fg: tokens.statusPreparing },
  ready: { label: "Ready", bg: tokens.statusReadySoft, fg: tokens.statusReady },
};
