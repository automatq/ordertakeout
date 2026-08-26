/**
 * The web app's design tokens, by hand, for now.
 *
 * Copied from the staff app, which is the second copy of the same values and
 * exactly the argument for the shared tokens package: three sources of truth for
 * one palette, and a rebrand now touches all three. It needs the workspace move.
 *
 * docs/THEMING.md makes rebranding a one-file change because every colour on the
 * web resolves through a token in app/globals.css. React Native cannot read CSS
 * custom properties, so these are literals — which means there are now two
 * sources of truth, and a rebrand touches both.
 *
 * That is the @harina/design-tokens package in the Phase 3 plan: one tokens.ts
 * generating both the CSS and this file, with CI failing if they drift. Worth
 * doing before the palette changes, not after.
 */
export const theme = {
  canvas: "#f5f1e9",
  surface: "#ffffff",
  brand: "#9E3136",
  ink: "#1c1917",
  inkMuted: "#57534e",
  inkSubtle: "#78716c",
  border: "#e7e0d4",
  danger: "#991b1b",
  ok: "#166534",
  okSurface: "#dcfce7",
  warn: "#78350f",
  warnSurface: "#fef3c7",
} as const;

/**
 * Order status, in the words a customer would use.
 *
 * Deliberately not the staff labels. "Paid" is a bookkeeping fact; what somebody
 * waiting for a cake wants to know is whether it has been started, and the shop
 * saying "we've got your order" is a different sentence from "New".
 */
export const statusStyle: Record<string, { label: string; bg: string; fg: string }> = {
  pending_payment: { label: "Not paid yet", bg: "#fee2e2", fg: "#991b1b" },
  paid: { label: "Order received", bg: theme.okSurface, fg: theme.ok },
  preparing: { label: "Being made", bg: theme.warnSurface, fg: theme.warn },
  ready: { label: "Ready to collect", bg: theme.okSurface, fg: theme.ok },
  completed: { label: "Collected", bg: "#e7e0d4", fg: theme.inkMuted },
  canceled: { label: "Cancelled", bg: "#e7e0d4", fg: theme.inkMuted },
};
