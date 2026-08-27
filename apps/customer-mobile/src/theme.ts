import { tokens } from "./tokens.generated";

/**
 * The app's colours, from the web's design tokens.
 *
 * `tokens.generated.ts` is written by scripts/generate-app-theme.mjs out of
 * app/globals.css, which stays the single source of truth. This file only
 * gives the ones this app uses shorter names.
 *
 * These were hand-copied at first and drifted within a day — the brand red was
 * #9E3136 here and #ce3f23 on the web. Nothing looked broken, which is exactly
 * how that fails. CI now regenerates and diffs.
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
 * Order status, in the words a customer would use.
 *
 * Deliberately not the staff labels. "Paid" is a bookkeeping fact; what
 * somebody waiting for a cake wants to know is whether it has been started, and
 * the shop saying "we've got your order" is a different sentence from "New".
 * The colours are the shared status tokens either way, so the two apps agree
 * about what amber means.
 */
export const statusStyle: Record<string, { label: string; bg: string; fg: string }> = {
  pending_payment: { label: "Not paid yet", bg: tokens.dangerSoft, fg: tokens.danger },
  paid: { label: "Order received", bg: tokens.statusReadySoft, fg: tokens.statusReady },
  preparing: { label: "Being made", bg: tokens.statusPreparingSoft, fg: tokens.statusPreparing },
  ready: { label: "Ready to collect", bg: tokens.statusReadySoft, fg: tokens.statusReady },
  completed: { label: "Collected", bg: tokens.statusCompletedSoft, fg: tokens.statusCompleted },
  canceled: { label: "Cancelled", bg: tokens.statusCanceledSoft, fg: tokens.statusCanceled },
};
