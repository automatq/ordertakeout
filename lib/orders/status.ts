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
  ready: ["completed", "canceled"],
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
