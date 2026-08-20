"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { completeCheckout, getCartAvailability, startCheckout } from "@/app/actions/checkout";
import { EmptyState } from "@/components/ui/empty-state";
import { AlertIcon, BagIcon, ClockIcon, MapPinIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { useCart } from "@/lib/cart/store";
import { usePickupLocation } from "@/lib/locations/store";
import { getPickupLocations } from "@/app/actions/locations";
import type { StoreLocation } from "@/lib/locations/types";
import { resolveCart, type ResolvedCartLine } from "@/lib/catalog/cart";
import { primaryImage, sizedImage } from "@/lib/catalog/images";
import type { CatalogProduct } from "@/lib/catalog/types";
import { isDemoModeClient } from "@/lib/demo/config";
import type { DayAvailability } from "@/lib/scheduling/availability";
import { formatPickupTime, formatStoreDate } from "@/lib/scheduling/time";
import { formatMoney } from "@/lib/square/money";
import { SLOT_HOLD_TTL_MINUTES, STORE_INFO } from "@/lib/store";

import { DemoPaymentForm } from "./demo-payment-form";
import { PaymentForm } from "./payment-form";
import { PickupPicker, type PickupSelection } from "./pickup-picker";

/**
 * The checkout flow: pickup selection, customer details, then payment.
 *
 * The slot is reserved by `startCheckout` *before* the card form appears, so the
 * pickup time can't be taken by someone else while the customer types their card
 * details. If they abandon, the reservation expires on its own.
 *
 * What changed in the overhaul:
 *
 *  - A step rail. Three phases share one route, so without it the customer had
 *    no idea whether they were halfway or nearly done.
 *  - Client-side validation. Every field was submitted blind: an empty form
 *    cost a network round trip to be told it was empty, and the errors that came
 *    back were keyed wrong and never rendered against a field (see
 *    `fieldErrorsByPath` in app/actions/checkout.ts).
 *  - Errors take focus. `role="alert"` served screen readers; a sighted user
 *    got a message that could be a screen above the button they just pressed.
 *  - The hold is visible. `SLOT_HOLD_TTL_MINUTES` was enforced but never shown,
 *    so expiry arrived as an unexplained error mid-payment.
 *  - There's a way back. Reaching payment used to replace the whole form, so a
 *    mistyped phone number or wrong pickup time could only be fixed with the
 *    browser's back button, which lost everything.
 */

type Customer = { name: string; email: string; phone: string };

const FIELDS = [
  {
    key: "name",
    label: "Name",
    type: "text",
    autoComplete: "name",
    // Keyed by the dotted path the server returns, so client and server
    // messages land in the same slot.
    path: "customer.name",
    validate: (value: string) => (value.trim() ? null : "Please enter your name."),
  },
  {
    key: "email",
    label: "Email",
    type: "email",
    autoComplete: "email",
    inputMode: "email" as const,
    hint: "We'll send your order confirmation here.",
    path: "customer.email",
    validate: (value: string) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
        ? null
        : "Please enter a valid email address.",
  },
  {
    key: "phone",
    label: "Phone",
    type: "tel",
    autoComplete: "tel",
    inputMode: "tel" as const,
    hint: "In case we need to reach you about your pickup.",
    path: "customer.phone",
    validate: (value: string) =>
      value.trim().length >= 7 ? null : "Please enter a phone number we can reach you on.",
  },
] as const;

export function CheckoutFlow({
  products,
  squareApplicationId,
}: {
  products: CatalogProduct[];
  squareApplicationId: string;
}) {
  const router = useRouter();
  const { items, ready, clear } = useCart();
  const { locationId } = usePickupLocation();
  const [locations, setLocations] = useState<StoreLocation[]>([]);
  const [isPending, startTransition] = useTransition();

  const [days, setDays] = useState<DayAvailability[] | null>(null);
  const [availabilityProblem, setAvailabilityProblem] = useState<string | null>(null);
  const [availabilityFor, setAvailabilityFor] = useState<string | null>(null);
  const [pickup, setPickup] = useState<PickupSelection | null>(null);
  const [customer, setCustomer] = useState<Customer>({ name: "", email: "", phone: "" });
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [reserved, setReserved] = useState<{
    orderId: string;
    subtotalCents: number;
    taxCents: number;
    totalCents: number;
    currency: string;
    /** The authoritative expiry from the server-side slot claim. */
    expiresAt: number;
  } | null>(null);

  const errorRef = useRef<HTMLDivElement | null>(null);
  const fieldRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const resolved = resolveCart(items, products);
  const subtotalCents = resolved.subtotalCents;
  const currency = reserved?.currency ?? resolved.currency;
  const availabilityKey = locationId
    ? `${locationId}:${items.map((item) => `${item.variantId}:${item.quantity}`).join(",")}`
    : null;

  // Load availability whenever the cart changes — different products have
  // different lead times, so the offered dates depend on what's in the basket.
  useEffect(() => {
    if (!ready || items.length === 0) return;
    let cancelled = false;

    if (!locationId) return;
    if (!resolved.ok) return;
    void getCartAvailability(items, locationId)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setDays(result.days);
          setAvailabilityProblem(null);
          setAvailabilityFor(availabilityKey);
          setPickup((current) => {
            if (!current) return current;
            const day = result.days.find((entry) => entry.date === current.date);
            return day?.slots.some((slot) => slot.time === current.time && slot.available)
              ? current
              : null;
          });
        } else {
          setDays([]);
          setAvailabilityProblem(describeProblem(result.problem.kind));
          setAvailabilityFor(availabilityKey);
          setPickup(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setDays([]);
        setAvailabilityProblem("We can't load pickup times right now. Please try again shortly or call the store.");
        setAvailabilityFor(availabilityKey);
        setPickup(null);
      });

    return () => {
      cancelled = true;
    };
  }, [availabilityKey, items, ready, locationId, resolved.ok]);

  useEffect(() => { void getPickupLocations().then(setLocations).catch(() => setLocations([])); }, []);
  const location = locations.find((entry) => entry.id === locationId) ?? null;
  const pickupProblem = !locationId
    ? "Choose a pickup location before choosing a time."
    : !resolved.ok
      ? "Remove unavailable items from your order before choosing a pickup time."
      : availabilityFor === availabilityKey
        ? availabilityProblem
        : null;
  const visibleDays = locationId && availabilityFor === availabilityKey ? days : null;

  if (!ready) return <CheckoutSkeleton />;

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<BagIcon className="h-6 w-6" />}
        title="Your order is empty"
        description="Add a party tray and we'll take it from there."
        action={{ label: "Browse party trays", href: "/#trays" }}
      />
    );
  }

  /** Validate locally first, so a typo costs nothing. */
  function validate(): boolean {
    const errors: Record<string, string[]> = {};

    for (const field of FIELDS) {
      const message = field.validate(customer[field.key]);
      if (message) errors[field.path] = [message];
    }
    if (!pickup) errors["pickup"] = ["Please choose a pickup date and time."];

    setFieldErrors(errors);

    const firstBad = FIELDS.find((field) => errors[field.path]);
    if (firstBad) {
      // Move the customer to the problem rather than leaving them to hunt for
      // a message that may have rendered off-screen.
      const input = fieldRefs.current[firstBad.key];
      input?.focus();
      input?.scrollIntoView({ block: "center", behavior: "smooth" });
    } else if (errors["pickup"]) {
      errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    return Object.keys(errors).length === 0;
  }

  function handleReserve() {
    setError(null);
    if (!resolved.ok) {
      setError("Remove unavailable items from your order before checkout.");
      errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (!validate() || !pickup) return;

    startTransition(async () => {
      try {
        const result = await startCheckout({
          locationId,
          cart: items,
          pickup,
          customer,
          note: note || undefined,
          expectedTotalCents: subtotalCents,
        });

        if (result.ok) {
          setReserved({
            orderId: result.orderId,
            subtotalCents: result.subtotalCents,
            taxCents: result.taxCents,
            totalCents: result.totalCents,
            currency: result.currency,
            expiresAt: result.holdExpiresAt.getTime(),
          });
          return;
        }

        if (result.failure.kind === "invalid_input") {
          const serverFieldErrors = result.failure.fieldErrors;
          setFieldErrors(serverFieldErrors);
          const firstBad = FIELDS.find((field) => serverFieldErrors[field.path]);
          if (firstBad) fieldRefs.current[firstBad.key]?.focus();
          return;
        }
        setError(describeFailure(result.failure));
        errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch {
        setError("We couldn't reserve that pickup time. Check your connection and try again.");
        errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
  }

  async function handleToken(token: string) {
    if (!reserved) return;
    let result;
    try {
      result = await completeCheckout({ orderId: reserved.orderId, sourceId: token });
    } catch {
      setError("We couldn't reach payment services. Your card was not charged; please try again.");
      return;
    }

    if (!result.ok) {
      setError(result.message);
      // A lapsed reservation means the whole selection must be redone.
      if (result.code === "HOLD_EXPIRED" || result.code === "STOCK_CHANGED") setReserved(null);
      return;
    }

    clear();
    router.push(`/orders/${result.orderNumber}?key=${encodeURIComponent(result.accessToken)}`);
  }

  const step = reserved ? 3 : pickup ? 2 : 1;

  return (
    <div className="flex flex-col gap-8">
      <Steps current={step} />

      {!resolved.ok ? (
        <div
          role="alert"
          className="panel border-danger/30 flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] p-4 sm:px-6"
        >
          <p className="text-ink text-sm">
            {resolved.unknownVariantIds.length === 1 ? "One item is" : "Some items are"} no longer available.
          </p>
          <Link href="/cart" className="btn btn-secondary btn-sm rounded-full">
            Review your order
          </Link>
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
        {/* min-w-0: a grid item defaults to `min-width: auto`, so the pickup
            date rail's 21 chips would size this column to their full width and
            push the whole page into a horizontal scroll instead of scrolling
            inside the rail. */}
        <div className="flex min-w-0 flex-col gap-8 lg:order-2">
          {!reserved ? (
            <>
              <section
                aria-labelledby="pickup-heading"
                className="card shadow-raised flex flex-col gap-5 rounded-[2rem] border-0 p-6 sm:p-8"
              >
                <div className="flex items-center gap-3">
                  <span className="bg-secondary text-secondary-ink flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                    1
                  </span>
                  <div>
                    <p className="text-secondary text-xs font-semibold tracking-[0.14em] uppercase">
                      Pickup
                    </p>
                    <h2
                      id="pickup-heading"
                      className="font-display text-ink text-3xl font-normal uppercase"
                    >
                      When would you like to collect?
                    </h2>
                  </div>
                </div>
                {location ? (
                  <p className="border-secondary/20 bg-secondary-soft text-ink-muted flex items-start gap-3 rounded-[1.25rem] border p-4 text-sm">
                    <span className="bg-secondary text-secondary-ink flex size-9 shrink-0 items-center justify-center rounded-full">
                      <MapPinIcon className="h-4 w-4" />
                    </span>
                    <span>
                      Pickup from <strong className="text-ink">{location.name}</strong>
                      <br />
                      {location.address}
                      {location.city ? `, ${location.city}` : ""}
                    </span>
                  </p>
                ) : null}

                {pickupProblem ? (
                  <p role="alert" className="field-error">
                    {pickupProblem}
                  </p>
                ) : visibleDays === null ? (
                  <div role="status" aria-busy className="flex flex-col gap-3">
                    <span className="sr-only">Loading pickup times</span>
                    <Skeleton className="h-4 w-28" />
                    <div className="flex gap-2">
                      {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton key={index} className="h-20 w-20" />
                      ))}
                    </div>
                    <Skeleton className="mt-2 h-4 w-28" />
                    <div className="flex gap-2">
                      {Array.from({ length: 4 }, (_, index) => (
                        <Skeleton key={index} className="h-11 w-24 rounded-pill" />
                      ))}
                    </div>
                  </div>
                ) : (
                  <PickupPicker
                    days={visibleDays}
                    value={pickup}
                    onChange={(selection) => {
                      setPickup(selection);
                      // Match the customer fields: validation feedback should
                      // disappear as soon as the customer fixes the problem.
                      setFieldErrors((current) => {
                        if (!current.pickup) return current;
                        const next = { ...current };
                        delete next.pickup;
                        return next;
                      });
                    }}
                  />
                )}

                {fieldErrors["pickup"] ? (
                  <p role="alert" className="field-error">
                    {fieldErrors["pickup"][0]}
                  </p>
                ) : null}
              </section>

              <section
                aria-labelledby="details-heading"
                className="card shadow-raised flex flex-col gap-5 rounded-[2rem] border-0 p-6 sm:p-8"
              >
                <div className="flex items-center gap-3">
                  <span className="bg-accent text-ink flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                    2
                  </span>
                  <div>
                    <p className="text-accent-ink text-xs font-semibold tracking-[0.14em] uppercase">
                      Contact
                    </p>
                    <h2
                      id="details-heading"
                      className="font-display text-ink text-3xl font-normal uppercase"
                    >
                      Your details
                    </h2>
                  </div>
                </div>

                {FIELDS.map((field) => (
                  <Field
                    key={field.key}
                    id={`checkout-${field.key}`}
                    label={field.label}
                    type={field.type}
                    autoComplete={field.autoComplete}
                    inputMode={"inputMode" in field ? field.inputMode : undefined}
                    hint={"hint" in field ? field.hint : undefined}
                    value={customer[field.key]}
                    errors={fieldErrors[field.path]}
                    inputRef={(node) => {
                      fieldRefs.current[field.key] = node;
                    }}
                    onChange={(value) => {
                      setCustomer((current) => ({ ...current, [field.key]: value }));
                      // Clear as they fix it — a message that outlives the
                      // problem trains people to ignore messages.
                      setFieldErrors((current) => {
                        if (!current[field.path]) return current;
                        const next = { ...current };
                        delete next[field.path];
                        return next;
                      });
                    }}
                  />
                ))}

                <label htmlFor="checkout-note" className="flex flex-col gap-1.5">
                  <span className="text-ink-subtle text-sm font-medium">
                    Notes for the store (optional)
                  </span>
                  <textarea
                    id="checkout-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder="Allergies, a name for the tray, anything we should know."
                    className="input"
                  />
                </label>
              </section>

              <div ref={errorRef}>
                {error ? (
                  <p role="alert" className="field-error">
                    {error}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={handleReserve}
                  disabled={isPending || !locationId || !resolved.ok}
                  className="btn btn-primary btn-block min-h-14 rounded-full px-8 text-base"
                >
                  {isPending ? (
                    <>
                      <span className="spinner" aria-hidden />
                      Reserving your pickup time…
                    </>
                  ) : (
                    "Continue to payment"
                  )}
                </button>
                <p className="text-ink-subtle text-xs">
                  We&rsquo;ll hold your pickup time for {SLOT_HOLD_TTL_MINUTES} minutes
                  while you pay. Nothing is charged until you confirm.
                </p>
              </div>
            </>
          ) : (
            <section
              aria-labelledby="payment-heading"
              className="card shadow-raised flex flex-col gap-5 rounded-[2rem] border-0 p-6 sm:p-8"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="bg-brand text-brand-ink flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                    3
                  </span>
                  <div>
                    <p className="text-brand text-xs font-semibold tracking-[0.14em] uppercase">
                      Secure checkout
                    </p>
                    <h2
                      id="payment-heading"
                      className="font-display text-ink text-3xl font-normal uppercase"
                    >
                      Payment
                    </h2>
                  </div>
                </div>
                <HoldCountdown
                  expiresAt={reserved.expiresAt}
                  onExpire={() => {
                    setReserved(null);
                    setError("Your pickup-time hold expired. Please choose a time again.");
                  }}
                />
              </div>

              {pickup ? (
                <div className="border-secondary/20 bg-secondary-soft flex flex-wrap items-center justify-between gap-3 rounded-[1.25rem] border p-4">
                  <p className="text-ink text-sm">
                    <span className="text-ink-subtle">Collecting</span>{" "}
                    {formatStoreDate(pickup.date, "long")} at {formatPickupTime(pickup.time)}
                  </p>
                  {/* Leaves the existing hold in place to expire on its own —
                      the same outcome as abandoning the tab, and far better than
                      trapping someone on a payment screen with a typo in their
                      phone number and no way back. */}
                  <button
                    type="button"
                    onClick={() => {
                      setReserved(null);
                      setError(null);
                    }}
                    className="btn btn-ghost btn-sm rounded-full"
                  >
                    Edit order details
                  </button>
                </div>
              ) : null}

              {error ? (
                <p role="alert" className="field-error">
                  {error}
                </p>
              ) : null}

              {isDemoModeClient() ? (
                <DemoPaymentForm
                  amountLabel={formatMoney(reserved.totalCents, currency)}
                  onToken={handleToken}
                />
              ) : (
                <PaymentForm
                  applicationId={squareApplicationId}
                  locationId={locationId ?? ""}
                  amountLabel={formatMoney(reserved.totalCents, currency)}
                  onToken={handleToken}
                />
              )}
            </section>
          )}
        </div>

        <OrderSummary
          lines={resolved.ok ? resolved.lines : []}
          subtotalCents={subtotalCents}
          taxCents={reserved?.taxCents ?? null}
          totalCents={reserved?.totalCents ?? subtotalCents}
          currency={currency}
          pickup={pickup}
          location={location}
        />
      </div>
    </div>
  );
}

function Steps({ current }: { current: 1 | 2 | 3 }) {
  const labels = ["Pickup", "Your details", "Payment"] as const;

  return (
    <ol
      aria-label="Checkout progress"
      className="steps bg-surface shadow-card overflow-x-auto rounded-[1.5rem] border border-border px-4 py-3 sm:px-6"
    >
      {labels.map((label, index) => {
        const position = index + 1;
        const state = position === current ? "current" : position < current ? "done" : "todo";
        return (
          <li
            key={label}
            className="step"
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
          >
            {label}
            {position < labels.length ? (
              <span
                aria-hidden
                className={`ml-1 h-0.5 w-4 sm:w-8 ${
                  position < current ? "bg-secondary" : "bg-border-strong"
                }`}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Counts the reservation down.
 *
 * The hold has always existed server-side; this is the first time the customer
 * can see it. It turns "your card was declined for a reason we won't explain"
 * into "you have four minutes left", and the warning tone at two minutes gives
 * them a chance to act on it.
 */
function HoldCountdown({
  expiresAt,
  onExpire,
}: {
  expiresAt: number;
  onExpire: () => void;
}) {
  const [remaining, setRemaining] = useState(() => expiresAt - Date.now());
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    expiredRef.current = false;
    const tick = () => {
      const next = expiresAt - Date.now();
      setRemaining(next);
      if (next <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpireRef.current();
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  const urgent = seconds <= 120;
  const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  if (seconds === 0) {
    return (
      <span className="tag text-danger border-danger/30 bg-danger-soft">
        <AlertIcon className="h-4 w-4" />
        Hold expired
      </span>
    );
  }

  return (
    <span className={`tag ${urgent ? "tag-accent" : ""}`}>
      <ClockIcon className="h-4 w-4" />
      {/* Announced only when it gets urgent — a per-second live region would be
          unusable, and a calm countdown isn't news. */}
      <span aria-live={urgent ? "polite" : "off"}>Time held: {label}</span>
    </span>
  );
}

function OrderSummary({
  lines,
  subtotalCents,
  taxCents,
  totalCents,
  currency,
  pickup,
  location,
}: {
  lines: ResolvedCartLine[];
  subtotalCents: number;
  taxCents: number | null;
  totalCents: number;
  currency: string;
  pickup: PickupSelection | null;
  location: StoreLocation | null;
}) {
  return (
    <aside
      aria-labelledby="summary-heading"
      className="card shadow-raised overflow-hidden rounded-[2rem] border-0 p-0 lg:order-1 lg:sticky lg:top-24"
    >
      <div className="bg-secondary text-secondary-ink px-6 py-5">
        <p className="text-accent text-xs font-semibold tracking-[0.14em] uppercase">
          Your pickup feast
        </p>
        <h2
          id="summary-heading"
          className="font-display mt-1 text-3xl font-normal uppercase"
        >
          Order summary
        </h2>
      </div>

      <div className="flex flex-col gap-5 p-6">
        <ul className="flex flex-col gap-3">
          {lines.map((line) => {
            const image = primaryImage(line.product);
            return (
              <li
                key={line.variant.id}
                className="bg-canvas flex items-start gap-3 rounded-[1.25rem] p-3"
              >
                {image ? (
                  <Image
                    src={sizedImage(image, 112)}
                    alt=""
                    width={56}
                    height={56}
                    className="rounded-control bg-surface-sunken h-14 w-14 shrink-0 object-cover"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="text-ink text-sm font-medium">{line.product.name}</p>
                  <p className="text-ink-subtle text-xs">
                    {line.variant.name} &times; {line.quantity}
                  </p>
                </div>
                <span className="text-ink shrink-0 text-sm font-semibold tabular-nums">
                  {formatMoney(line.lineTotalCents, line.variant.currency)}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col gap-2">
          <div className="text-ink-muted flex items-baseline justify-between text-sm">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatMoney(subtotalCents, currency)}</span>
          </div>
          <div className="text-ink-muted flex items-baseline justify-between text-sm">
            <span>Taxes</span>
            <span className="tabular-nums">
              {taxCents === null ? "Calculated at payment" : formatMoney(taxCents, currency)}
            </span>
          </div>
          <div className="bg-accent-soft text-ink mt-1 flex items-baseline justify-between rounded-[1.25rem] px-4 py-3 font-semibold">
            <span>Total</span>
            <span className="font-display text-3xl font-normal">
              {formatMoney(totalCents, currency)}
            </span>
          </div>
        </div>

        {pickup ? (
          <p className="border-secondary/20 bg-secondary-soft text-ink-muted flex items-start gap-2 rounded-[1.25rem] border p-3 text-sm">
            <ClockIcon className="text-secondary mt-0.5 h-4 w-4 shrink-0" />
            {formatStoreDate(pickup.date, "long")} at {formatPickupTime(pickup.time)}
          </p>
        ) : null}

        <p className="text-ink-subtle flex items-start gap-2 text-xs leading-relaxed">
          <MapPinIcon className="text-brand mt-0.5 h-4 w-4 shrink-0" />
          Collect from {location ? `${location.name}, ${location.address}${location.city ? `, ${location.city}` : ""}` : "your selected pickup location"}. We&rsquo;ll email your
          confirmation as soon as payment goes through.
        </p>
      </div>
    </aside>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  errors,
  hint,
  type = "text",
  autoComplete,
  inputMode,
  inputRef,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  errors?: string[];
  hint?: string;
  type?: string;
  autoComplete?: string;
  inputMode?: "email" | "tel";
  inputRef?: (node: HTMLInputElement | null) => void;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = errors?.length ? `${id}-error` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-ink-subtle text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        required
        aria-invalid={errors?.length ? true : undefined}
        /* Both, so the format guidance survives the error rather than being
           replaced by it. */
        aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
        className="input"
      />
      {errors?.length ? (
        <span id={errorId} role="alert" className="field-error">
          {errors[0]}
        </span>
      ) : null}
      {hint ? (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function CheckoutSkeleton() {
  return (
    <div role="status" aria-busy className="flex flex-col gap-6">
      <span className="sr-only">Loading checkout</span>
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

function describeProblem(kind: string): string {
  switch (kind) {
    case "no_common_pickup_time":
      return "The items in your order have different pickup times. Please place them as separate orders.";
    case "catalog_unavailable":
      return "We can't load pickup times right now. Please try again shortly or call the store.";
    default:
      return "We couldn't work out pickup times for this order. Please call the store.";
  }
}

function describeFailure(failure: { kind: string }): string {
  switch (failure.kind) {
    case "slot_rejected":
      return "That pickup time was just taken. Please choose another.";
    case "price_changed":
      return "Prices changed while you were ordering. Please review your order and try again.";
    case "unknown_items":
      return "Something in your order is no longer available. Please review your order.";
    case "insufficient_stock":
      return "We don't have enough of an item at this pickup location. Please review the quantities in your order.";
    case "catalog_unavailable":
      return "We can't reach our menu right now. Please try again shortly or call the store.";
    default:
      return "We couldn't start checkout. Please try again.";
  }
}
