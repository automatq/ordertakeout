import type { OrderStatus } from "@/lib/db/schema";

/**
 * Status metadata shared by the server and the kitchen screen.
 *
 * Deliberately free of `server-only` and of any database or Square import: the
 * dashboard is a client component and needs these, and a value import from a
 * server module would drag Postgres and the Square SDK into the browser bundle.
 * Types are erased at compile time, so importing `OrderStatus` is fine — values
 * are not.
 */

/** Transitions staff may make from the dashboard, by current status. */
export const STAFF_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["canceled"],
  paid: ["preparing", "ready", "canceled"],
  preparing: ["ready", "canceled"],
  // Completion is intentionally absent: it requires counter verification,
  // rather than a generic lifecycle action.
  ready: ["canceled"],
  completed: [],
  canceled: [],
};

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: "Unpaid",
  paid: "New order",
  preparing: "Preparing",
  ready: "Ready for pickup",
  completed: "Completed",
  canceled: "Cancelled",
};

/** Button copy for moving *into* a status. */
export const ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  preparing: "Start preparing",
  ready: "Mark ready",
  completed: "Picked up",
  canceled: "Cancel",
};

/**
 * Badge class per status.
 *
 * Lives here because the queue and the prep timeline both need it and each
 * carried its own copy — two places to update, and no guarantee they agreed.
 */
export const BADGE_CLASS: Record<OrderStatus, string> = {
  pending_payment: "badge badge-completed",
  paid: "badge badge-new",
  preparing: "badge badge-preparing",
  ready: "badge badge-ready",
  completed: "badge badge-completed",
  canceled: "badge badge-canceled",
};

/**
 * Left-edge colour per status, for cards on the queue and tickets on the
 * timeline.
 *
 * The timeline had this and the queue didn't, which meant the screen staff
 * actually work from was the one where every card looked identical. Always
 * accompanies the text label — the edge is a scanning aid, not the information.
 */
export const STATUS_EDGE: Record<OrderStatus, string> = {
  pending_payment: "border-l-status-completed",
  paid: "border-l-status-new",
  preparing: "border-l-status-preparing",
  ready: "border-l-status-ready",
  completed: "border-l-status-completed",
  canceled: "border-l-status-canceled",
};
