import { notFound } from "next/navigation";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { PrintControls } from "@/components/staff/print-controls";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { serverEnv } from "@/lib/env";
import { getOrdersForDate, summariseProduction } from "@/lib/orders/dashboard";
import { getStoreLocationsSafe } from "@/lib/locations/server";
import {
  formatPickupTime,
  formatStoreDate,
  isStoreDate,
  storeNowTime,
  storeToday,
} from "@/lib/scheduling/time";
import { STORE_INFO } from "@/lib/store";

type PageProps = {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ location?: string }>;
};

export const metadata = { title: "Prep sheet — Staff" };

/**
 * Printable prep sheet for one pickup day.
 *
 * Leads with production totals rather than customer names: at 5am the kitchen
 * needs "12 × 25pc Ube", not a list of people. The per-slot handout list follows,
 * for the counter later in the day.
 *
 * The print treatment itself lives in the `@media print` block in globals.css —
 * before the overhaul there wasn't one, and the whole strategy was four `print:`
 * utilities. The visible consequences were that the customer header printed at
 * the top of every sheet, background fills (including the customer-note
 * highlight) silently vanished because browsers drop them by default, body copy
 * printed as mid-grey, and a long order could split across a page break.
 */
export default function PrintPage({ params, searchParams }: PageProps) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8 print:px-0 print:py-0">
      <Suspense fallback={<PrepSheetSkeleton />}>
        <PrepSheet params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function PrepSheet({ params, searchParams }: PageProps) {
  await connection();

  const { date } = await params;
  const { location: requestedLocationId } = await searchParams;
  if (!isStoreDate(date)) notFound();

  const locations = await getStoreLocationsSafe();
  if (!requestedLocationId) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="font-display text-ink text-2xl font-normal uppercase">
          Choose a prep-sheet location
        </h1>
        <p className="text-ink-muted text-sm">
          Prep sheets are separated by branch so Toronto and London production can never be mixed.
        </p>
        <ul className="flex flex-col gap-2">
          {locations.map((entry) => (
            <li key={entry.id}>
              <Link href={`/staff/print/${date}?location=${encodeURIComponent(entry.id)}`} className="btn btn-secondary btn-block justify-start">
                {entry.name} — {entry.address}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const location = locations.find((entry) => entry.id === requestedLocationId);
  if (!location) notFound();

  const orders = await getOrdersForDate(date, location.id);
  const active = orders.filter((o) => o.status !== "canceled");
  const canceled = orders.filter((o) => o.status === "canceled");
  const production = summariseProduction(orders);

  const bySlot = new Map<string, typeof orders>();
  for (const order of active) {
    bySlot.set(order.pickupTime, [...(bySlot.get(order.pickupTime) ?? []), order]);
  }

  return (
    <>
      <PrintControls date={date} locationId={location.id} />

      <div className="flex flex-col gap-8">
        {/* `data-print-keep` opts this out of the blanket "hide headers in
            print" rule — this is the sheet's own header, not site chrome. */}
        <header data-print-keep className="border-border flex flex-col gap-1 border-b pb-4">
          <h1 className="font-display text-ink text-2xl font-normal uppercase">
            Prep sheet &middot; {formatStoreDate(date)}
          </h1>
          <p className="text-ink-muted text-sm">
            {location?.name ?? `${STORE_INFO.name} — all locations`} &middot; {active.length} order
            {active.length === 1 ? "" : "s"} for pickup
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
                  <span className="text-ink text-lg font-semibold tabular-nums">
                    {line.quantity}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-ink-subtle text-sm font-semibold tracking-wide uppercase">
            Handout by pickup time
          </h2>

          {bySlot.size === 0 ? (
            <p className="text-ink-muted text-sm">No orders booked for this day.</p>
          ) : (
            [...bySlot.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([time, slotOrders]) => (
                <div key={time} className="flex flex-col gap-2">
                  <h3 className="text-ink font-semibold">{formatPickupTime(time)}</h3>
                  <ul className="flex flex-col gap-2">
                    {slotOrders.map((order) => (
                      /* break-inside-avoid on the order, not just the slot
                         group: a slot longer than a page would otherwise split
                         a single order's item list across the fold. */
                      <li
                        key={order.id}
                        className="border-border break-inside-avoid rounded-card border p-3"
                      >
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
                          <p
                            data-print-fill
                            className="bg-accent-soft text-accent-ink rounded-control mt-2 px-2 py-1 text-sm"
                          >
                            <strong className="font-semibold">Note:</strong>{" "}
                            {order.customerNote}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
          )}
        </section>

        {/* Cancellations were filtered out and never mentioned, so staff had no
            way to tell an order had been cancelled versus never placed — which
            matters when a customer turns up expecting one. */}
        {canceled.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-ink-subtle text-sm font-semibold tracking-wide uppercase">
              Cancelled ({canceled.length}) — do not bake
            </h2>
            <ul className="text-ink-muted flex flex-col gap-1 text-sm">
              {canceled.map((order) => (
                <li key={order.id}>
                  {order.orderNumber} &middot; {order.customerName} &middot;{" "}
                  {formatPickupTime(order.pickupTime)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <PrintedAt />
      </div>
    </>
  );
}

/**
 * A "printed at" stamp, so two sheets for the same day can be told apart when
 * both are lying on the bench and the orders don't match.
 *
 * Rendered on the server in the store's timezone. Safe to read the clock here:
 * this is a server component behind `await connection()`, so it renders once per
 * request and never hydrates — no mismatch to worry about.
 */
function PrintedAt() {
  const now = new Date();
  const timeZone = serverEnv().STORE_TIMEZONE;

  return (
    <p className="text-ink-subtle border-border border-t pt-4 text-xs">
      {STORE_INFO.name} &middot; generated{" "}
      <time dateTime={now.toISOString()}>
        {formatStoreDate(storeToday(now, timeZone), "medium")} at{" "}
        {formatPickupTime(storeNowTime(now, timeZone))}
      </time>
    </p>
  );
}

function PrepSheetSkeleton() {
  return (
    <LoadingRegion label="Loading prep sheet" className="flex flex-col gap-6">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-64 w-full" />
    </LoadingRegion>
  );
}
