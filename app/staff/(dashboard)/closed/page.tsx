import { connection } from "next/server";
import { Suspense } from "react";

import { getRecentlyClosed } from "@/lib/orders/dashboard";
import { formatPickupTime } from "@/lib/scheduling/time";
import { formatMoney } from "@/lib/square/money";

export const metadata = { title: "Completed orders — Staff" };

/** Recently completed and cancelled orders, for looking something up after the fact. */
export default function ClosedOrdersPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="font-display text-ink mb-6 text-2xl font-semibold">Recently closed</h1>
      <Suspense fallback={<p className="text-ink-muted text-sm">Loading…</p>}>
        <ClosedList />
      </Suspense>
    </div>
  );
}

async function ClosedList() {
  await connection();

  const orders = await getRecentlyClosed();

  if (orders.length === 0) {
    return <p className="text-ink-muted">Nothing closed yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {orders.map((order) => (
        <li
          key={order.id}
          className="rounded-card border-border bg-surface flex flex-wrap items-center justify-between gap-3 border p-4"
        >
          <div className="flex flex-col">
            <span className="text-ink font-semibold">
              {order.orderNumber} &middot; {order.customerName}
            </span>
            <span className="text-ink-muted text-sm">
              {order.pickupDate} at {formatPickupTime(order.pickupTime)} &middot;{" "}
              {order.items.reduce((n, i) => n + i.quantity, 0)} item(s)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-control px-2 py-1 text-sm font-semibold ${
                order.status === "canceled"
                  ? "bg-status-canceled-soft text-status-canceled"
                  : "bg-status-completed-soft text-status-completed"
              }`}
            >
              {order.status === "canceled" ? "Cancelled" : "Completed"}
            </span>
            <span className="text-ink font-semibold">
              {formatMoney(order.totalCents, order.currency)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
