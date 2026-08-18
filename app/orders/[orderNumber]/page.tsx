import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { getOrderByNumber } from "@/lib/orders/lookup";
import { formatPickupTime, formatStoreDate } from "@/lib/scheduling/time";
import { formatMoney } from "@/lib/square/money";
import { STORE_HOURS } from "@/lib/store";

type PageProps = { params: Promise<{ orderNumber: string }> };

export const metadata = { title: "Your order — Party Tray Pre-Orders" };

export default function OrderPage({ params }: PageProps) {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
      <Suspense fallback={<p className="text-ink-muted text-sm">Loading your order…</p>}>
        <OrderDetail params={params} />
      </Suspense>
    </main>
  );
}

async function OrderDetail({ params }: PageProps) {
  const { orderNumber } = await params;
  const order = await getOrderByNumber(orderNumber);

  if (!order) notFound();

  const paid = order.status !== "pending_payment" && order.status !== "canceled";

  return (
    <>
      <header className="flex flex-col gap-3">
        {paid ? (
          <p className="text-success text-sm font-semibold tracking-wide uppercase">
            Order confirmed
          </p>
        ) : null}
        <h1 className="font-display text-ink text-3xl font-semibold">
          {order.status === "canceled" ? "Order cancelled" : "Thanks for your order"}
        </h1>
        <p className="text-ink-muted">
          Order <strong className="text-ink font-semibold">{order.orderNumber}</strong>
          {paid ? " — we've emailed your confirmation." : null}
        </p>
      </header>

      <section
        aria-label="Pickup details"
        className="rounded-card border-border bg-surface flex flex-col gap-1 border p-6"
      >
        <h2 className="text-ink-subtle text-sm font-semibold tracking-wide uppercase">
          Pickup
        </h2>
        <p className="text-ink text-2xl font-semibold">
          {formatStoreDate(order.pickupDate)} at {formatPickupTime(order.pickupTime)}
        </p>
        <p className="text-ink-muted text-sm">
          Collect in store. We&rsquo;re open {STORE_HOURS.opens}&ndash;{STORE_HOURS.closes} daily.
        </p>
      </section>

      <section aria-label="Items" className="flex flex-col gap-3">
        <h2 className="text-ink-subtle text-sm font-semibold tracking-wide uppercase">
          Items
        </h2>
        <ul className="flex flex-col gap-2">
          {order.items.map((item) => (
            <li
              key={item.id}
              className="rounded-control border-border bg-surface flex items-center justify-between border px-4 py-3"
            >
              <span className="text-ink">
                {item.quantity} &times; {item.nameSnapshot}
              </span>
              <span className="text-ink font-semibold">
                {formatMoney(item.totalPriceCents, order.currency)}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-ink flex justify-between text-lg font-semibold">
          <span>{paid ? "Paid" : "Total"}</span>
          <span>{formatMoney(order.totalCents, order.currency)}</span>
        </p>
      </section>

      <Link href="/" className="text-brand text-sm underline">
        Order something else
      </Link>
    </>
  );
}
