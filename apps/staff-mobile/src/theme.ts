/**
 * The web app's design tokens, by hand, for now.
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

/** Status colours, keyed by the order statuses the queue actually shows. */
export const statusStyle: Record<string, { label: string; bg: string; fg: string }> = {
  paid: { label: "New", bg: "#fee2e2", fg: "#991b1b" },
  preparing: { label: "Preparing", bg: theme.warnSurface, fg: theme.warn },
  ready: { label: "Ready", bg: theme.okSurface, fg: theme.ok },
};
