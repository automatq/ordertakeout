import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getOrdersForDate, summariseProduction } from "@/lib/orders/dashboard";
import { formatPickupTime, formatStoreDate, isStoreDate } from "@/lib/scheduling/time";

type PageProps = { params: Promise<{ date: string }> };

export const metadata = { title: "Prep sheet — Staff" };

/**
 * Printable prep sheet for one pickup day.
 *
 * Leads with production totals rather than customer names: at 5am the kitchen
 * needs "12 × 25pc Ube", not a list of people. The per-slot handout list follows,
 * for the counter later in the day.
 */
export default function PrintPage({ params }: PageProps) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8 print:px-0 print:py-0">
      <Suspense fallback={<p className="text-ink-muted text-sm">Loading…</p>}>
        <PrepSheet params={params} />
      </Suspense>
    </div>
  );
}

async function PrepSheet({ params }: PageProps) {
  await connection();

  const { date } = await params;
  if (!isStoreDate(date)) notFound();

  const orders = await getOrdersForDate(date);
  const active = orders.filter((o) => o.status !== "canceled");
  const production = summariseProduction(orders);

  const bySlot = new Map<string, typeof orders>();
  for (const order of active) {
    bySlot.set(order.pickupTime, [...(bySlot.get(order.pickupTime) ?? []), order]);
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-ink text-2xl font-semibold">
          Prep sheet &middot; {formatStoreDate(date)}
        </h1>
        <p className="text-ink-muted text-sm">
          {active.length} order{active.length === 1 ? "" : "s"} for pickup
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-ink-subtle text-sm font-semibold tracking-wide uppercase">
          Bake totals
        </h2>
        {production.length === 0 ? (
          <p className="text-ink-muted text-sm">Nothing to bake for this day.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {production.map((line) => (
              <li
                key={line.name}
                className="border-border flex items-baseline justify-between border-b py-2"
              >
                <span className="text-ink">{line.name}</span>
                <span className="text-ink text-lg font-semibold">{line.quantity}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-ink-subtle text-sm font-semibold tracking-wide uppercase">
          Handout by pickup time
        </h2>
        {[...bySlot.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([time, slotOrders]) => (
            <div key={time} className="flex flex-col gap-2 break-inside-avoid">
              <h3 className="text-ink font-semibold">{formatPickupTime(time)}</h3>
              <ul className="flex flex-col gap-2">
                {slotOrders.map((order) => (
                  <li key={order.id} className="border-border rounded-card border p-3">
                    <p className="text-ink font-medium">
                      {order.orderNumber} &middot; {order.customerName} &middot;{" "}
                      {order.customerPhone}
                    </p>
                    <ul className="text-ink-muted mt-1 text-sm">
                      {order.items.map((item) => (
                        <li key={item.id}>
                          {item.quantity}&times; {item.nameSnapshot}
                        </li>
                      ))}
                    </ul>
                    {order.customerNote ? (
                      <p className="text-ink mt-1 text-sm">Note: {order.customerNote}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </section>
    </div>
  );
}
