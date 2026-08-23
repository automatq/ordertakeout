import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PhoneIcon, SearchIcon } from "@/components/ui/icons";
import { ListSkeleton } from "@/components/ui/skeleton";
import { searchClosedOrders } from "@/lib/orders/dashboard";
import { formatPickupTime, formatStoreDate, isStoreDate } from "@/lib/scheduling/time";
import { formatMoney } from "@/lib/square/money";
import { getStoreLocationsSafe } from "@/lib/locations/server";

export const metadata = { title: "Completed orders — Staff" };

/**
 * Recently completed and cancelled orders.
 *
 * The screen's whole purpose is post-hoc lookup, but it used to be the last 25
 * rows by `updatedAt` with no search, no status filter and no date range — so
 * the one order a staff member actually needed was usually unreachable.
 *
 * Filters live in the URL rather than in client state: a plain GET form needs no
 * JavaScript, the result is linkable and refreshable, and staff can bookmark a
 * range they check regularly.
 */

const RESULT_LIMIT = 25;

type PageProps = {
  searchParams: Promise<{ q?: string; status?: string; from?: string; to?: string; location?: string; page?: string }>;
};

export default function ClosedOrdersPage({ searchParams }: PageProps) {
  return (
    <div className="shell flex flex-col gap-6 py-8">
      <h1 className="font-display text-ink text-display-md font-normal uppercase">
        Completed &amp; cancelled
      </h1>

      <Suspense fallback={<ListSkeleton label="Loading closed orders" rows={4} />}>
        <ClosedList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ClosedList({ searchParams }: PageProps) {
  await connection();

  const params = await searchParams;
  const search = params.q?.trim() ?? "";
  const status =
    params.status === "completed" || params.status === "canceled" ? params.status : undefined;
  // Anything that isn't a real store date is ignored rather than passed to SQL.
  const from = params.from && isStoreDate(params.from) ? params.from : undefined;
  const to = params.to && isStoreDate(params.to) ? params.to : undefined;
  const locations = await getStoreLocationsSafe();
  const locationId = locations.some((location) => location.id === params.location)
    ? params.location
    : undefined;
  const requestedPage = Number(params.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const offset = (page - 1) * RESULT_LIMIT;

  const result = await searchClosedOrders({
    search,
    status,
    from,
    to,
    locationId,
    limit: RESULT_LIMIT + 1,
    offset,
  });
  const hasNext = result.length > RESULT_LIMIT;
  const orders = result.slice(0, RESULT_LIMIT);

  const filtered = Boolean(search || status || from || to || locationId);

  return (
    <>
      <form method="get" className="card grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
          <label htmlFor="closed-q" className="text-ink-subtle text-sm font-medium">
            Search
          </label>
          <input
            id="closed-q"
            name="q"
            defaultValue={search}
            placeholder="Order number, name or phone"
            className="input"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="closed-location" className="text-ink-subtle text-sm font-medium">Location</label>
          <select id="closed-location" name="location" defaultValue={locationId ?? ""} className="input">
            <option value="">All locations</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="closed-status" className="text-ink-subtle text-sm font-medium">
            Status
          </label>
          <select id="closed-status" name="status" defaultValue={status ?? ""} className="input">
            <option value="">Both</option>
            <option value="completed">Completed</option>
            <option value="canceled">Cancelled</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="closed-from" className="text-ink-subtle text-sm font-medium">
            Pickup from
          </label>
          <input
            id="closed-from"
            name="from"
            type="date"
            defaultValue={from ?? ""}
            className="input"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="closed-to" className="text-ink-subtle text-sm font-medium">
            Pickup to
          </label>
          <input id="closed-to" name="to" type="date" defaultValue={to ?? ""} className="input" />
        </div>

        <div className="flex flex-wrap items-end gap-3 sm:col-span-2 lg:col-span-5">
          <button type="submit" className="btn btn-primary btn-sm">
            <SearchIcon className="h-4 w-4" />
            Search
          </button>
          {filtered ? (
            <Link href="/staff/closed" className="btn btn-ghost btn-sm">
              Clear filters
            </Link>
          ) : null}
        </div>
      </form>

      {orders.length === 0 ? (
        <EmptyState
          icon={<SearchIcon className="h-6 w-6" />}
          title={filtered ? "No orders match those filters" : "Nothing closed yet"}
          description={
            filtered
              ? "Try a shorter search term, or widen the date range."
              : "Completed and cancelled orders will be listed here."
          }
        />
      ) : (
        <>
          <p className="text-ink-subtle text-sm" aria-live="polite">
            Showing {offset + 1}–{offset + orders.length}
          </p>

          <ul className="flex flex-col gap-2">
            {orders.map((order) => (
              <li key={order.id} className="card p-4">
                {/* Expandable rather than a bare count: the line items are
                    already loaded, then were reduced to "N item(s)" — so the
                    one thing you came here to check was thrown away. */}
                <details className="group">
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 list-none">
                    <div className="flex flex-col">
                      <span className="text-ink font-semibold">
                        {order.orderNumber} &middot; {order.customerName}
                      </span>
                      <span className="text-ink-muted text-sm">
                        {formatStoreDate(order.pickupDate, "medium")} at{" "}
                        {formatPickupTime(order.pickupTime)} &middot;{" "}
                        {order.pickupLocationName ?? "Legacy location"} &middot;{" "}
                        {order.items.reduce((n, i) => n + i.quantity, 0)} item(s)
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`badge ${
                          order.status === "canceled" ? "badge-canceled" : "badge-completed"
                        }`}
                      >
                        {order.status === "canceled" ? "Cancelled" : "Completed"}
                      </span>
                      <span className="text-ink font-display text-lg font-normal">
                        {formatMoney(order.totalCents, order.currency)}
                      </span>
                      <span
                        aria-hidden
                        className="text-ink-subtle text-xs transition-transform group-open:rotate-180"
                      >
                        ▾
                      </span>
                    </div>
                  </summary>

                  <div className="border-border mt-4 flex flex-col gap-3 border-t pt-4">
                    <ul className="text-ink flex flex-col gap-1 text-sm">
                      {order.items.map((item) => (
                        <li key={item.id}>
                          <strong className="font-semibold">{item.quantity}&times;</strong>{" "}
                          {item.nameSnapshot}
                        </li>
                      ))}
                    </ul>

                    {order.customerNote ? (
                      <p className="panel text-ink-muted p-3 text-sm">
                        <strong className="text-ink font-semibold">Note:</strong>{" "}
                        {order.customerNote}
                      </p>
                    ) : null}

                    {order.status === "completed" ? (
                      order.pickupVerification ? (
                        <p className="panel text-ink-muted p-3 text-sm">
                          <strong className="text-ink font-semibold">Pickup verified:</strong>{" "}
                          {order.pickupVerification.method === "qr" ? "QR pass" : "Manual order lookup"} by {order.pickupVerification.staffInitials} at {formatVerificationTime(order.pickupVerification.verifiedAt, order.pickupLocationTimezone)}.
                        </p>
                      ) : (
                        <p className="panel text-warning p-3 text-sm">
                          Pickup verification unavailable — this completed order predates the counter verification system.
                        </p>
                      )
                    ) : null}

                    {/* Finding the order was only ever half the job; the other
                        half is calling the customer about it. */}
                    <div className="flex flex-wrap gap-3">
                      <a
                        href={`tel:${order.customerPhone}`}
                        className="btn btn-secondary btn-sm"
                      >
                        <PhoneIcon className="h-4 w-4" />
                        {order.customerPhone}
                      </a>
                      <Link
                        href={`/orders/${order.orderNumber}`}
                        className="btn btn-ghost btn-sm"
                      >
                        Customer view
                      </Link>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>

          <nav aria-label="Closed-order pages" className="flex items-center justify-between gap-3">
            {page > 1 ? (
              <Link href={pageHref(params, page - 1)} className="btn btn-secondary btn-sm">
                &larr; Newer
              </Link>
            ) : <span />}
            <span className="text-ink-subtle text-sm">Page {page}</span>
            {hasNext ? (
              <Link href={pageHref(params, page + 1)} className="btn btn-secondary btn-sm">
                Older &rarr;
              </Link>
            ) : <span />}
          </nav>
        </>
      )}
    </>
  );
}

function formatVerificationTime(value: Date, timeZone: string | null): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timeZone ?? undefined,
  }).format(value);
}

function pageHref(
  current: Awaited<PageProps["searchParams"]>,
  page: number,
): string {
  const query = new URLSearchParams();
  for (const key of ["q", "status", "from", "to", "location"] as const) {
    const value = current[key];
    if (value) query.set(key, value);
  }
  if (page > 1) query.set("page", String(page));
  const suffix = query.toString();
  return suffix ? `/staff/closed?${suffix}` : "/staff/closed";
}
