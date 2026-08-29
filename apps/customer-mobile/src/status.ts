import type { Palette } from "./tokens.generated";

/**
 * Order status, in the words a customer would use.
 *
 * Deliberately not the staff labels. "Paid" is a bookkeeping fact; somebody
 * waiting for a cake wants to know whether it has been started, and the shop
 * saying "we've got your order" is a different sentence from "New".
 *
 * Colours come from the shared status tokens, so amber means the same thing in
 * the kitchen and in a customer's hand.
 */
export function statusFor(status: string, c: Palette): { label: string; fg: string; bg: string } {
  switch (status) {
    case "pending_payment":
      return { label: "Not paid yet", fg: c.danger, bg: c.dangerSoft };
    case "paid":
      return { label: "Order received", fg: c.statusReady, bg: c.statusReadySoft };
    case "preparing":
      return { label: "Being made", fg: c.statusPreparing, bg: c.statusPreparingSoft };
    case "ready":
      return { label: "Ready to collect", fg: c.statusReady, bg: c.statusReadySoft };
    case "completed":
      return { label: "Collected", fg: c.statusCompleted, bg: c.statusCompletedSoft };
    case "canceled":
      return { label: "Cancelled", fg: c.statusCanceled, bg: c.statusCanceledSoft };
    default:
      return { label: status, fg: c.inkMuted, bg: c.surfaceSunken };
  }
}
