"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { completeCheckout, getCartAvailability, startCheckout } from "@/app/actions/checkout";
import { useCart } from "@/lib/cart/store";
import { resolveCart } from "@/lib/catalog/cart";
import type { CatalogProduct } from "@/lib/catalog/types";
import type { DayAvailability } from "@/lib/scheduling/availability";
import { formatMoney } from "@/lib/square/money";

import { PickupPicker, type PickupSelection } from "./pickup-picker";
import { PaymentForm } from "./payment-form";

/**
 * The checkout flow: pickup selection, customer details, then payment.
 *
 * The slot is reserved by `startCheckout` *before* the card form appears, so the
 * pickup time can't be taken by someone else while the customer types their card
 * details. If they abandon, the reservation expires on its own.
 */
export function CheckoutFlow({
  products,
  squareApplicationId,
  squareLocationId,
}: {
  products: CatalogProduct[];
  squareApplicationId: string;
  squareLocationId: string;
}) {
  const router = useRouter();
  const { items, ready, clear } = useCart();
  const [isPending, startTransition] = useTransition();

  const [days, setDays] = useState<DayAvailability[] | null>(null);
  const [availabilityProblem, setAvailabilityProblem] = useState<string | null>(null);
  const [pickup, setPickup] = useState<PickupSelection | null>(null);
  const [customer, setCustomer] = useState({ name: "", email: "", phone: "" });
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [reserved, setReserved] = useState<{ orderId: string; totalCents: number } | null>(null);

  const resolved = resolveCart(items, products);
  const subtotalCents = resolved.ok ? resolved.subtotalCents : 0;
  const currency = resolved.ok ? resolved.currency : "USD";

  // Load availability whenever the cart changes — different products have
  // different lead times, so the offered dates depend on what's in the basket.
  useEffect(() => {
    if (!ready || items.length === 0) return;
    let cancelled = false;

    void getCartAvailability(items).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setDays(result.days);
        setAvailabilityProblem(null);
      } else {
        setDays([]);
        setAvailabilityProblem(describeProblem(result.problem.kind));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [items, ready]);

  if (!ready) return null;

  if (items.length === 0) {
    return (
      <p className="text-ink-muted">
        Your order is empty.{" "}
        <Link href="/" className="text-brand underline">
          Browse party trays
        </Link>
        .
      </p>
    );
  }

  function handleReserve() {
    if (!pickup) {
      setError("Please choose a pickup date and time.");
      return;
    }
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await startCheckout({
        cart: items,
        pickup,
        customer,
        note: note || undefined,
        expectedTotalCents: subtotalCents,
      });

      if (result.ok) {
        setReserved({ orderId: result.orderId, totalCents: result.totalCents });
        return;
      }

      if (result.failure.kind === "invalid_input") {
        setFieldErrors(result.failure.fieldErrors);
        return;
      }
      setError(describeFailure(result.failure));
    });
  }

  async function handleToken(token: string) {
    if (!reserved) return;
    const result = await completeCheckout({ orderId: reserved.orderId, sourceId: token });

    if (!result.ok) {
      setError(result.message);
      // A lapsed reservation means the whole selection must be redone.
      if (result.code === "HOLD_EXPIRED") setReserved(null);
      return;
    }

    clear();
    router.push(`/orders/${result.orderNumber}`);
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Your order" className="flex flex-col gap-3">
        <h2 className="text-ink-subtle text-sm font-semibold tracking-wide uppercase">
          Your order
        </h2>
        <ul className="flex flex-col gap-2">
          {resolved.ok
            ? resolved.lines.map((line) => (
                <li
                  key={line.variant.id}
                  className="rounded-control border-border bg-surface flex items-center justify-between border px-4 py-3"
                >
                  <span className="text-ink">
                    {line.quantity} &times; {line.product.name} &mdash; {line.variant.name}
                  </span>
                  <span className="text-ink font-semibold">
                    {formatMoney(line.lineTotalCents, line.variant.currency)}
                  </span>
                </li>
              ))
            : null}
        </ul>
        <p className="text-ink flex justify-between text-lg font-semibold">
          <span>Total</span>
          <span>{formatMoney(subtotalCents, currency)}</span>
        </p>
      </section>

      {!reserved ? (
        <>
          <section aria-label="Pickup time" className="flex flex-col gap-3">
            {availabilityProblem ? (
              <p role="alert" className="text-danger text-sm">
                {availabilityProblem}
              </p>
            ) : days === null ? (
              <p className="text-ink-muted text-sm">Loading pickup times…</p>
            ) : (
              <PickupPicker days={days} value={pickup} onChange={setPickup} />
            )}
          </section>

          <section aria-label="Your details" className="flex flex-col gap-4">
            <h2 className="text-ink-subtle text-sm font-semibold tracking-wide uppercase">
              Your details
            </h2>
            <Field
              label="Name"
              value={customer.name}
              errors={fieldErrors["customer.name"] ?? fieldErrors["name"]}
              onChange={(v) => setCustomer((c) => ({ ...c, name: v }))}
            />
            <Field
              label="Email"
              type="email"
              value={customer.email}
              errors={fieldErrors["customer.email"] ?? fieldErrors["email"]}
              onChange={(v) => setCustomer((c) => ({ ...c, email: v }))}
            />
            <Field
              label="Phone"
              type="tel"
              value={customer.phone}
              errors={fieldErrors["customer.phone"] ?? fieldErrors["phone"]}
              onChange={(v) => setCustomer((c) => ({ ...c, phone: v }))}
            />
            <label className="flex flex-col gap-1">
              <span className="text-ink-subtle text-sm font-medium">
                Notes for the store (optional)
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={500}
                className="rounded-control border-border bg-surface text-ink border px-3 py-2"
              />
            </label>
          </section>

          {error ? (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            onClick={handleReserve}
            disabled={isPending || !pickup}
            className="rounded-control bg-brand text-brand-ink hover:bg-brand-hover px-5 py-3 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Reserving your pickup time…" : "Continue to payment"}
          </button>
        </>
      ) : (
        <section aria-label="Payment" className="flex flex-col gap-4">
          <h2 className="text-ink-subtle text-sm font-semibold tracking-wide uppercase">
            Payment
          </h2>
          <p className="text-ink-muted text-sm">
            Your pickup time is held while you pay.
          </p>
          {error ? (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          ) : null}
          <PaymentForm
            applicationId={squareApplicationId}
            locationId={squareLocationId}
            amountLabel={formatMoney(reserved.totalCents, currency)}
            onToken={handleToken}
          />
        </section>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  errors,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  errors?: string[];
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ink-subtle text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={errors ? true : undefined}
        className="rounded-control border-border bg-surface text-ink border px-3 py-2"
      />
      {errors?.length ? (
        <span role="alert" className="text-danger text-sm">
          {errors[0]}
        </span>
      ) : null}
    </label>
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
    case "catalog_unavailable":
      return "We can't reach our menu right now. Please try again shortly or call the store.";
    default:
      return "We couldn't start checkout. Please try again.";
  }
}
