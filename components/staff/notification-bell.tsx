"use client";

import { useEffect, useRef, useState } from "react";

import { BellIcon } from "@/components/ui/icons";
import type { DashboardOrder } from "@/lib/orders/dashboard";
import { formatPickupTime, formatStoreDate } from "@/lib/scheduling/time";
import { formatMoney } from "@/lib/square/money";

/**
 * Notification bell for the order queue.
 *
 * Distinct from the sound toggle next to it: sound is an audible ping that only
 * fires while the tab is open and only once, at the moment an order lands. This
 * is the visual record of what you missed — step away for ten minutes and come
 * back, the badge count is still there and the dropdown still lists exactly
 * which orders arrived, in a screen that would otherwise look identical to how
 * you left it.
 *
 * Deliberately reuses `freshIds` from `OrderQueue` rather than keeping its own
 * notion of "new" — one source of truth for what counts as unseen, shared with
 * the pulsing card highlight, so the bell count and the highlighted cards can
 * never disagree.
 */
export function NotificationBell({
  orders,
  onDismissAll,
  onJumpTo,
}: {
  /** Orders currently considered "fresh", newest first. */
  orders: DashboardOrder[];
  onDismissAll: () => void;
  onJumpTo: (orderId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click outside or Escape closes the panel — standard disclosure behaviour,
  // and the only way to dismiss it short of acting on every order.
  useEffect(() => {
    if (!open) return;

    function handlePointer(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={
          orders.length > 0 ? `Notifications, ${orders.length} unread` : "Notifications"
        }
        className="btn btn-secondary btn-icon btn-sm relative"
      >
        <BellIcon className="h-4 w-4" />
        {orders.length > 0 ? (
          <span
            aria-hidden
            className="bg-brand text-brand-ink rounded-pill absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center px-1 text-xs font-semibold"
          >
            {orders.length > 9 ? "9+" : orders.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="New orders"
          className="card shadow-raised absolute top-full right-0 z-20 mt-2 flex max-h-96 w-80 flex-col overflow-hidden p-0"
        >
          <div className="border-border flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-ink text-sm font-semibold">New orders</h2>
            {orders.length > 0 ? (
              <button
                type="button"
                onClick={onDismissAll}
                className="text-ink-muted hover:text-brand text-xs underline underline-offset-2 transition-colors"
              >
                Clear all
              </button>
            ) : null}
          </div>

          {orders.length === 0 ? (
            <p className="text-ink-subtle p-4 text-sm">
              Nothing new. Orders will appear here as they come in.
            </p>
          ) : (
            <ul className="divide-border flex flex-col divide-y overflow-y-auto">
              {orders.map((order) => (
                <li key={order.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onJumpTo(order.id);
                      setOpen(false);
                    }}
                    className="hover:bg-surface-sunken flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors"
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-ink text-sm font-semibold">
                        {order.orderNumber} &middot; {order.customerName}
                      </span>
                      <span className="text-ink-subtle shrink-0 text-xs tabular-nums">
                        {formatMoney(order.totalCents, order.currency)}
                      </span>
                    </span>
                    <span className="text-ink-muted text-xs">
                      Pickup {formatStoreDate(order.pickupDate, "short")} at{" "}
                      {formatPickupTime(order.pickupTime)}{order.pickupLocationName ? ` · ${order.pickupLocationName}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
