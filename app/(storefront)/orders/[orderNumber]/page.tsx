import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { OrderProgress } from "@/components/orders/order-progress";
import { OrderRefresher } from "@/components/orders/order-refresher";
import { AlertIcon, CalendarIcon, ClockIcon, LoafIcon, MapPinIcon, PhoneIcon } from "@/components/ui/icons";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { ALLERGEN_DISCLAIMER, ALLERGEN_LABELS } from "@/lib/catalog/dietary";
import { googleCalendarUrl } from "@/lib/orders/calendar-link";
import { getOrderByNumber } from "@/lib/orders/lookup";
import { formatPickupTime, formatStoreDate } from "@/lib/scheduling/time";
import { formatMoney } from "@/lib/square/money";
import { STORE_HOURS, STORE_INFO } from "@/lib/store";
import { hasStaffSession } from "@/lib/auth/guard";
import { verifyOrderAccessToken } from "@/lib/orders/access";
import { customerCancellationEligibility } from "@/lib/orders/cancellation";
import { CancelOrder } from "@/components/orders/cancel-order";
import { OfflinePassRegistration } from "@/components/orders/offline-pass";
import { PickupPass } from "@/components/orders/pickup-pass";
import { getOrderableProducts } from "@/lib/catalog/server";
import { primaryImage, sizedImage } from "@/lib/catalog/images";
import { createPickupPass } from "@/lib/orders/pickup-pass";
import { CreateAccount } from "@/components/accounts/create-account";

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
    <main className="shell-tight flex flex-col gap-8 py-8 sm:py-12 lg:py-16">
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
  const staffSession = await hasStaffSession();
  const hasCustomerAccess = verifyOrderAccessToken(order.id, order.orderNumber, key);
  if (!staffSession && !hasCustomerAccess) {
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
      <header className="bg-brand text-brand-ink shadow-raised relative isolate flex flex-col gap-4 overflow-hidden rounded-[2rem] px-6 py-8 sm:rounded-[2.5rem] sm:px-10 sm:py-10">
        <span
          aria-hidden
          className="bg-accent/30 absolute -top-16 -right-10 -z-10 size-56 rounded-full blur-2xl"
        />
        <span
          aria-hidden
          className="bg-brand-hover/60 absolute -bottom-24 left-1/3 -z-10 size-64 rounded-full blur-3xl"
        />
        <p className="bg-accent text-ink inline-flex self-start rounded-full px-4 py-2 text-xs font-semibold tracking-[0.14em] uppercase">
          {paid ? "Order confirmed" : canceled ? "Order update" : "Awaiting payment"}
        </p>

        <h1 className="font-display text-display-lg font-normal uppercase">
          {canceled ? "Order cancelled" : "Thanks for your order"}
        </h1>

        {/* The order number is the thing the customer reads out at the counter,
            so it gets its own block rather than being buried in a sentence. */}
        <div className="bg-surface text-ink flex flex-wrap items-center justify-between gap-4 rounded-[1.5rem] p-5">
          <div>
            <p className="text-brand text-xs font-semibold tracking-[0.14em] uppercase">
              Order number
            </p>
            <p className="font-display text-3xl font-normal">{order.orderNumber}</p>
          </div>
          {paid ? (
            <p className="text-ink-muted max-w-sm text-sm text-pretty">
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
          className="card shadow-raised border-danger/20 flex flex-col gap-4 rounded-[2rem] p-6 sm:p-8"
          aria-labelledby="cancel-heading"
        >
          <div className="flex items-center gap-3">
            <span className="bg-danger-soft text-danger flex size-11 items-center justify-center rounded-full">
              <AlertIcon className="h-5 w-5" />
            </span>
            <h2
              id="cancel-heading"
              className="font-display text-ink text-3xl font-normal uppercase"
            >
              This order was cancelled
            </h2>
          </div>
          <p className="text-ink-muted text-sm text-pretty">
            {order.refundStatus === "completed"
              ? "Your full refund was accepted by Square and is being returned to the card you used. It can take a few working days to appear."
              : "This order was cancelled before payment, so no charge or refund was needed."}{" "}
            If you weren&rsquo;t expecting this, call us and we&rsquo;ll sort it out.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href={pickupPhoneHref} className="btn btn-secondary btn-sm rounded-full">
              <PhoneIcon className="h-4 w-4" />
              {pickupPhone}
            </a>
            <Link href="/#order" className="btn btn-outline btn-sm rounded-full">
              Order again
            </Link>
          </div>
        </section>
      ) : (
        <>
          <section
            aria-labelledby="pickup-heading"
            className="card shadow-raised overflow-hidden rounded-[2rem] border-0"
          >
            <div className="bg-secondary text-secondary-ink flex items-center gap-3 px-6 py-5 sm:px-8">
              <span className="bg-accent text-ink flex size-10 shrink-0 items-center justify-center rounded-full">
                <MapPinIcon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-accent text-xs font-semibold tracking-[0.14em] uppercase">
                  Your bakery
                </p>
                <h2
                  id="pickup-heading"
                  className="font-display text-3xl font-normal uppercase"
                >
                  Pickup details
                </h2>
              </div>
            </div>

            <div className="flex flex-col gap-4 p-6 sm:p-8">

              <p className="text-ink font-display text-4xl font-normal">
                {formatStoreDate(order.pickupDate)} at {formatPickupTime(order.pickupTime)}
              </p>
              {order.pickupLocationName ? (
                <p className="text-ink text-lg font-semibold">{order.pickupLocationName}</p>
              ) : null}

              <dl className="text-ink-muted bg-canvas flex flex-col gap-3 rounded-[1.25rem] p-4 text-sm">
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
                className="btn btn-secondary btn-sm rounded-full"
              >
                <MapPinIcon className="h-4 w-4" />
                Directions
              </a>
              <a
                href={googleCalendarUrl({ date: order.pickupDate, time: order.pickupTime, orderNumber: order.orderNumber, locationName: order.pickupLocationName ?? STORE_INFO.name, address: pickupAddress, city: pickupCity, phone: pickupPhone })}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary btn-sm rounded-full"
              >
                <CalendarIcon className="h-4 w-4" />
                Add to calendar
              </a>
              <a href={pickupPhoneHref} className="btn btn-ghost btn-sm rounded-full">
                <PhoneIcon className="h-4 w-4" />
                Call about this order
              </a>
              </div>
            </div>
          </section>

          <OrderProgress status={order.status} />
          {paid && order.status !== "completed" ? (
            <>
              <PickupPass value={createPickupPass(order.id, order.orderNumber)} />
              <OfflinePassRegistration />
            </>
          ) : null}
          {paid && hasCustomerAccess && key ? <CreateAccount orderNumber={order.orderNumber} accessToken={key} /> : null}
          <OrderRefresher live={live} />
          {cancellation?.allowed && key ? (
            <section className="card flex flex-col gap-3 rounded-[1.5rem] p-5 sm:p-6">
              <h2 className="font-display text-ink text-2xl font-normal uppercase">
                Need to cancel?
              </h2>
              <p className="text-ink-muted text-sm">
                You can cancel online before production begins. A successful cancellation
                refunds the original card in full.
              </p>
              <CancelOrder
                orderNumber={order.orderNumber}
                accessToken={key}
                totalCents={order.totalCents}
                currency={order.currency}
              />
            </section>
          ) : cancellation && !cancellation.allowed && order.status !== "ready" && order.status !== "completed" ? (
            <p className="panel rounded-[1.5rem] p-4 text-sm text-ink-muted">
              {cancellation.reason}
            </p>
          ) : null}
        </>
      )}

      <section
        aria-labelledby="items-heading"
        className="card flex flex-col gap-5 rounded-[2rem] p-6 sm:p-8"
      >
        <div>
          <p className="text-brand text-xs font-semibold tracking-[0.14em] uppercase">
            Your feast
          </p>
          <h2
            id="items-heading"
            className="font-display text-ink mt-1 text-3xl font-normal uppercase"
          >
            Order items
          </h2>
        </div>

        <ul className="flex flex-col gap-2">
          {order.items.map((item) => {
            const product = item.squareProductId ? productsById.get(item.squareProductId) : null;
            const image = product ? primaryImage(product) : null;
            return (
              <li
                key={item.id}
                className="bg-canvas flex items-center gap-3 rounded-[1.25rem] px-4 py-3"
              >
                <span className="bg-surface-sunken text-brand/30 relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-control">
                  {image ? (
                    <Image src={sizedImage(image, 112)} alt="" fill sizes="56px" className="object-cover" />
                  ) : (
                    <LoafIcon className="h-6 w-6" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-ink block">
                    {item.quantity} &times; {item.nameSnapshot}
                  </span>
                  {/* Live catalog values, not an order-time snapshot: a recipe
                      change should update what the customer sees. */}
                  {product && product.allergens.length > 0 ? (
                    <span className="text-ink-subtle block text-xs">
                      Contains {product.allergens.map((allergen) => ALLERGEN_LABELS[allergen].toLowerCase()).join(", ")}
                    </span>
                  ) : null}
                </span>
                <span className="text-ink shrink-0 font-semibold tabular-nums">
                  {formatMoney(item.totalPriceCents, order.currency)}
                </span>
              </li>
            );
          })}
        </ul>

        {order.items.some((item) => {
          const product = item.squareProductId ? productsById.get(item.squareProductId) : null;
          return product ? product.allergens.length > 0 : false;
        }) ? (
          <p className="text-ink-subtle text-xs">{ALLERGEN_DISCLAIMER}</p>
        ) : null}

        <dl className="flex flex-col gap-2">
          <div className="text-ink-muted flex items-baseline justify-between text-sm">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">{formatMoney(order.subtotalCents, order.currency)}</dd>
          </div>
          <div className="text-ink-muted flex items-baseline justify-between text-sm">
            <dt>Taxes</dt>
            <dd className="tabular-nums">{formatMoney(order.taxCents, order.currency)}</dd>
          </div>
          {order.tipCents > 0 ? (
            <div className="text-ink-muted flex items-baseline justify-between text-sm">
              <dt>Tip</dt>
              <dd className="tabular-nums">{formatMoney(order.tipCents, order.currency)}</dd>
            </div>
          ) : null}
          <div className="bg-accent-soft text-ink mt-2 flex items-baseline justify-between rounded-[1.25rem] px-4 py-3 text-lg font-semibold">
            <dt>{paid ? "Paid" : "Total"}</dt>
            <dd className="font-display text-2xl font-normal">
              {formatMoney(order.totalCents + order.tipCents, order.currency)}
            </dd>
          </div>
        </dl>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link href="/#order" className="btn btn-outline btn-sm rounded-full">
          Order something else
        </Link>
        <Link href="/orders" className="btn btn-ghost btn-sm rounded-full">
          Look up another order
        </Link>
      </div>
    </>
  );
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
