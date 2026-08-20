import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { OrderProgress } from "@/components/orders/order-progress";
import { OrderRefresher } from "@/components/orders/order-refresher";
import { AlertIcon, CalendarIcon, ClockIcon, LoafIcon, MapPinIcon, PhoneIcon } from "@/components/ui/icons";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { getOrderByNumber } from "@/lib/orders/lookup";
import { formatPickupTime, formatStoreDate } from "@/lib/scheduling/time";
import { formatMoney } from "@/lib/square/money";
import { STORE_HOURS, STORE_INFO } from "@/lib/store";
import { hasStaffSession } from "@/lib/auth/guard";
import { verifyOrderAccessToken } from "@/lib/orders/access";
import { customerCancellationEligibility } from "@/lib/orders/cancellation";
import { CancelOrder } from "@/components/orders/cancel-order";
import { getOrderableProducts } from "@/lib/catalog/server";
import { primaryImage, sizedImage } from "@/lib/catalog/images";

type PageProps = {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ key?: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orderNumber } = await params;
  // The number itself, so a customer with several tabs open can tell them apart.
  return { title: `Order ${orderNumber}`, robots: { index: false } };
}

export default function OrderPage({ params, searchParams }: PageProps) {
  return (
    <main className="shell-narrow flex flex-col gap-8 py-12 sm:py-16">
      <Suspense fallback={<OrderSkeleton />}>
        <OrderDetail params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function OrderDetail({ params, searchParams }: PageProps) {
  const { orderNumber } = await params;
  const { key } = await searchParams;
  const order = await getOrderByNumber(orderNumber);

  if (!order) notFound();
  if (!(await hasStaffSession()) && !verifyOrderAccessToken(order.id, order.orderNumber, key)) {
    notFound();
  }

  // Images are presentation only: an order must remain usable if Square's
  // catalog is temporarily unavailable or the item has since been archived.
  const catalog = await getOrderableProducts();
  const productsById = new Map(catalog.products.map((product) => [product.id, product]));

  const canceled = order.status === "canceled";
  const paid = order.status !== "pending_payment" && !canceled;
  // Only an in-flight order has anything left to poll for.
  const live = paid && order.status !== "completed";
  const cancellation = paid ? await customerCancellationEligibility(order) : null;

  const pickupAddress = order.pickupLocationAddress ?? STORE_INFO.street;
  const pickupCity = order.pickupLocationCity ?? STORE_INFO.city;
  const pickupPhone = order.pickupLocationPhone ?? STORE_INFO.phone;
  const pickupPhoneHref = `tel:${pickupPhone.replace(/[^+\d]/g, "")}`;
  const mapsQuery = encodeURIComponent(`${pickupAddress}, ${pickupCity}`);
  const pickupHours = hoursForDate(order.pickupLocationHours, order.pickupDate);

  return (
    <>
      <header className="flex flex-col gap-3">
        {paid ? <p className="eyebrow text-success">Order confirmed</p> : null}

        <h1 className="font-display text-ink text-display-lg font-normal uppercase">
          {canceled ? "Order cancelled" : "Thanks for your order"}
        </h1>

        {/* The order number is the thing the customer reads out at the counter,
            so it gets its own block rather than being buried in a sentence. */}
        <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-ink-subtle text-xs tracking-wide uppercase">Order number</p>
            <p className="text-ink font-display text-2xl font-normal">{order.orderNumber}</p>
          </div>
          {paid ? (
            <p className="text-ink-muted max-w-xs text-sm text-pretty">
              We&rsquo;ve emailed your confirmation to {order.customerEmail}.
            </p>
          ) : null}
        </div>
      </header>

      {canceled ? (
        /* Cancellation used to leave a bare heading: the "Order confirmed"
           eyebrow silently disappeared, the progress rail returned null, and
           nothing explained what had happened or what to do next. */
        <section
          role="status"
          className="panel border-danger/30 flex flex-col gap-3 p-5"
          aria-labelledby="cancel-heading"
        >
          <h2 id="cancel-heading" className="text-ink flex items-center gap-2 font-semibold">
            <AlertIcon className="text-danger h-5 w-5" />
            This order was cancelled
          </h2>
          <p className="text-ink-muted text-sm text-pretty">
            {order.refundStatus === "completed"
              ? "Your full refund was accepted by Square and is being returned to the card you used. It can take a few working days to appear."
              : "This order was cancelled before payment, so no charge or refund was needed."}{" "}
            If you weren&rsquo;t expecting this, call us and we&rsquo;ll sort it out.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href={pickupPhoneHref} className="btn btn-secondary btn-sm">
              <PhoneIcon className="h-4 w-4" />
              {pickupPhone}
            </a>
            <Link href="/#trays" className="btn btn-outline btn-sm">
              Order again
            </Link>
          </div>
        </section>
      ) : (
        <>
          <section aria-labelledby="pickup-heading" className="card flex flex-col gap-4 p-6">
            <h2
              id="pickup-heading"
              className="text-ink-subtle text-sm font-semibold tracking-wide uppercase"
            >
              Pickup
            </h2>

            <p className="text-ink font-display text-3xl font-normal">
              {formatStoreDate(order.pickupDate)} at {formatPickupTime(order.pickupTime)}
            </p>
            {order.pickupLocationName ? <p className="text-ink font-semibold">{order.pickupLocationName}</p> : null}

            <dl className="text-ink-muted flex flex-col gap-2 text-sm">
              <div className="flex items-start gap-3">
                <MapPinIcon className="text-brand mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <dt className="sr-only">Address</dt>
                  <dd>
                    <address className="not-italic">
                      {pickupAddress}, {pickupCity}
                    </address>
                  </dd>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ClockIcon className="text-brand mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <dt className="sr-only">Opening hours</dt>
                  <dd>
                    {pickupHours ?? `Open ${STORE_HOURS.opens}–${STORE_HOURS.closes}`}
                  </dd>
                </div>
              </div>
            </dl>

            <div className="flex flex-wrap gap-3 pt-1">
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary btn-sm"
              >
                <MapPinIcon className="h-4 w-4" />
                Directions
              </a>
              <a
                href={calendarLink(order.pickupDate, order.pickupTime, order.orderNumber, order.pickupLocationName ?? STORE_INFO.name, pickupAddress, pickupCity, pickupPhone)}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary btn-sm"
              >
                <CalendarIcon className="h-4 w-4" />
                Add to calendar
              </a>
              <a href={pickupPhoneHref} className="btn btn-ghost btn-sm">
                <PhoneIcon className="h-4 w-4" />
                Call about this order
              </a>
            </div>
          </section>

          <OrderProgress status={order.status} />
          <OrderRefresher live={live} />
          {cancellation?.allowed && key ? (
            <section className="flex flex-col gap-2 border-t border-border pt-5">
              <h2 className="text-ink font-semibold">Need to cancel?</h2>
              <p className="text-ink-muted text-sm">You can cancel online before production begins. A successful cancellation refunds the original card in full.</p>
              <CancelOrder orderNumber={order.orderNumber} accessToken={key} totalCents={order.totalCents} currency={order.currency} />
            </section>
          ) : cancellation && !cancellation.allowed && order.status !== "ready" && order.status !== "completed" ? (
            <p className="panel p-4 text-sm text-ink-muted">{cancellation.reason}</p>
          ) : null}
        </>
      )}

      <section aria-labelledby="items-heading" className="flex flex-col gap-3">
        <h2
          id="items-heading"
          className="text-ink-subtle text-sm font-semibold tracking-wide uppercase"
        >
          Items
        </h2>

        <ul className="flex flex-col gap-2">
          {order.items.map((item) => {
            const product = item.squareProductId ? productsById.get(item.squareProductId) : null;
            const image = product ? primaryImage(product) : null;
            return (
              <li
                key={item.id}
                className="rounded-control border-border bg-surface flex items-center gap-3 border px-4 py-3"
              >
                <span className="bg-surface-sunken text-brand/30 relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-control">
                  {image ? (
                    <Image src={sizedImage(image, 112)} alt="" fill sizes="56px" className="object-cover" />
                  ) : (
                    <LoafIcon className="h-6 w-6" />
                  )}
                </span>
                <span className="text-ink min-w-0 flex-1">
                  {item.quantity} &times; {item.nameSnapshot}
                </span>
              <span className="text-ink shrink-0 font-semibold tabular-nums">
                {formatMoney(item.totalPriceCents, order.currency)}
              </span>
              </li>
            );
          })}
        </ul>

        <dl className="border-border flex flex-col gap-2 border-t pt-3">
          <div className="text-ink-muted flex items-baseline justify-between text-sm">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">{formatMoney(order.subtotalCents, order.currency)}</dd>
          </div>
          <div className="text-ink-muted flex items-baseline justify-between text-sm">
            <dt>Taxes</dt>
            <dd className="tabular-nums">{formatMoney(order.taxCents, order.currency)}</dd>
          </div>
          <div className="text-ink flex items-baseline justify-between text-lg font-semibold">
            <dt>{paid ? "Paid" : "Total"}</dt>
            <dd className="font-display text-2xl font-normal">
              {formatMoney(order.totalCents, order.currency)}
            </dd>
          </div>
        </dl>
      </section>

      <div className="border-border flex flex-wrap gap-3 border-t pt-6">
        <Link href="/#trays" className="btn btn-outline btn-sm">
          Order something else
        </Link>
        <Link href="/orders" className="btn btn-ghost btn-sm">
          Look up another order
        </Link>
      </div>
    </>
  );
}

/**
 * A Google Calendar "add event" link for the pickup.
 *
 * Deliberately not an .ics download: that needs a route handler and a MIME
 * type, and this covers the case that actually matters — a customer on a phone
 * who wants a reminder not to forget the tray they've already paid for.
 *
 * The times are the store's wall clock. Google reads a floating (zoneless)
 * timestamp in the viewer's own zone, which is right for a local bakery and
 * wrong only for someone booking from another timezone — a trade for not
 * dragging a tz conversion into a convenience link.
 */
function calendarLink(date: string, time: string, orderNumber: string, locationName: string, address: string, city: string, phone: string): string {
  const start = `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  const end = `${date.replace(/-/g, "")}T${String((hours + 1) % 24).padStart(2, "0")}${String(
    minutes,
  ).padStart(2, "0")}00`;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `Pick up order ${orderNumber} — ${locationName}`,
    dates: `${start}/${end}`,
    location: `${address}, ${city}`,
    details: `Collect your party tray order ${orderNumber}. Call ${phone} if you need to change anything.`,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function hoursForDate(
  periods: { dayOfWeek: string; startTime: string; endTime: string }[] | null,
  date: string,
): string | null {
  if (!periods?.length) return null;
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
  const day = days[new Date(`${date}T12:00:00Z`).getUTCDay()];
  const matches = periods.filter((period) => period.dayOfWeek === day);
  if (!matches.length) return "Store hours unavailable — call before pickup";
  return `Open ${matches.map((period) => `${formatPickupTime(period.startTime)}–${formatPickupTime(period.endTime)}`).join(", ")}`;
}

function OrderSkeleton() {
  return (
    <LoadingRegion label="Loading your order" className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-20 w-full" />
      </div>
      <Skeleton className="h-52 w-full" />
      <Skeleton className="h-64 w-full" />
    </LoadingRegion>
  );
}
