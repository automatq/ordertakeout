"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { useToast } from "@/components/ui/toast";
import { useCart } from "@/lib/cart/store";
import { getVariantAvailability } from "@/app/actions/locations";
import { usePickupLocation } from "@/lib/locations/store";
import type { CatalogVariant } from "@/lib/catalog/types";
import { formatPickupTime } from "@/lib/scheduling/time";
import { formatMoney } from "@/lib/square/money";

/**
 * Variant picker plus quantity, for the product page.
 *
 * Three changes worth knowing about:
 *
 *  - Sizes are radio *cards*, not a bare radio list. The selected state used to
 *    be a soft tint plus a 1px border, and keyboard focus landed on the native
 *    radio with no visible ring on the row it belonged to.
 *  - Quantity uses a stepper. A `type=number` spinner has a ~10px hit area on
 *    desktop and none at all on touch, and typing 99 snapped silently to 50.
 *  - Confirmation is a toast. The old inline "Added." could render below the
 *    fold, never dismissed, and — because the node never changed — didn't
 *    re-announce when you added a second tray.
 */

const MAX_QUANTITY = 50;

export function AddToCart({
  variants,
  productName,
  leadTimeDays,
  orderCutoffTime,
}: {
  variants: CatalogVariant[];
  productName: string;
  leadTimeDays: number;
  orderCutoffTime: string;
}) {
  const { add } = useCart();
  const { locationId } = usePickupLocation();
  const toast = useToast();
  const router = useRouter();
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [availabilityState, setAvailabilityState] = useState<{ locationId: string; values: Record<string, boolean> } | null>(null);
  const [inventoryErrorLocation, setInventoryErrorLocation] = useState<string | null>(null);
  const [inventoryAttempt, setInventoryAttempt] = useState(0);
  useEffect(() => {
    if (!locationId) return;
    let canceled = false;
    void getVariantAvailability({
      locationId,
      variantIds: variants.map((variant) => variant.id),
    })
      .then((result) => {
        if (!canceled) {
          if (result.ok) {
            setAvailabilityState({ locationId, values: result.values });
            setInventoryErrorLocation(null);
          } else {
            setAvailabilityState(null);
            setInventoryErrorLocation(locationId);
          }
        }
      })
      .catch(() => {
        if (!canceled) setInventoryErrorLocation(locationId);
      });
    return () => {
      canceled = true;
    };
  }, [inventoryAttempt, locationId, variants]);
  const availability = availabilityState?.locationId === locationId ? availabilityState.values : null;
  const inventoryError = inventoryErrorLocation === locationId;

  const selected = variants.find((v) => v.id === variantId) ?? variants[0];
  if (!selected) return null;

  const selectedInStock = availability?.[selected.id];
  const totalCents = selected.priceCents * quantity;

  return (
    <div className="bg-surface shadow-raised flex flex-col gap-6 rounded-[2rem] p-5 sm:p-7">
      <div className="flex items-center justify-between gap-4">
        <p className="eyebrow text-secondary">Build your tray</p>
        <span className="tag tag-accent">
          {variants.length} size{variants.length === 1 ? "" : "s"}
        </span>
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="font-display text-ink text-3xl font-normal uppercase">
          Choose a size
        </legend>

        <div className="flex flex-col gap-3 pt-1">
          {variants.map((variant) => {
            const perPiece = pricePerPiece(variant);
            const inStock = availability?.[variant.id];
            const isSelected = variant.id === variantId;
            const isSoldOut = inStock === false;

            return (
              <label
                key={variant.id}
                className={`relative flex min-h-20 items-center justify-between gap-4 rounded-[1.5rem] border-2 px-4 py-3 transition-[border-color,background-color,box-shadow,transform] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand sm:px-5 ${
                  isSoldOut
                    ? "border-border bg-surface-sunken cursor-not-allowed"
                    : isSelected
                      ? "border-secondary bg-secondary-soft shadow-card"
                      : "border-border bg-canvas hover:border-accent hover:bg-accent-soft cursor-pointer hover:-translate-y-0.5"
                }`}
              >
                <span className="flex items-center gap-3">
                  {/* Visually hidden rather than removed: the native control is
                      what makes this a real radio group for keyboard and
                      assistive tech. `.radio-card` mirrors its focus ring. */}
                  <input
                    type="radio"
                    name="variant"
                    value={variant.id}
                    checked={variant.id === variantId}
                    disabled={isSoldOut}
                    onChange={() => setVariantId(variant.id)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                      isSelected
                        ? "border-secondary bg-secondary"
                        : "border-border-strong"
                    }`}
                  >
                    {isSelected ? (
                      <span className="bg-accent h-1.5 w-1.5 rounded-full" />
                    ) : null}
                  </span>
                  <span>
                    <span className="text-ink block font-medium">{variant.name}</span>
                    {isSoldOut ? (
                      <span className="text-danger block pt-0.5 text-xs font-medium">
                        Sold out here
                      </span>
                    ) : null}
                  </span>
                </span>

                <span
                  className={`shrink-0 rounded-full px-3 py-2 text-right ${
                    isSelected ? "bg-surface" : "bg-surface/75"
                  }`}
                >
                  <span className="text-brand font-display block text-2xl leading-none font-normal">
                    {formatMoney(variant.priceCents, variant.currency)}
                  </span>
                  {/* The whole point of a bigger tray is that it's better value;
                      without this the customer has to do the division. */}
                  {perPiece ? (
                    <span className="text-ink-subtle block text-xs">
                      {formatMoney(perPiece, variant.currency)} per piece
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-4">
        <QuantityStepper
          label={`Quantity of ${selected.name}`}
          value={quantity}
          min={1}
          max={MAX_QUANTITY}
          onChange={setQuantity}
          onClamp={(attempted) =>
            toast({
              tone: "info",
              message: `Online quantities are limited to ${MAX_QUANTITY} trays — we've set it to ${MAX_QUANTITY}. For ${attempted}, please call the store.`,
            })
          }
        />

        <button
          type="button"
          onClick={() => {
            if (!locationId) { toast({ tone: "info", message: "Choose a pickup location before adding items." }); return; }
            if (selectedInStock !== true) return;
            add(selected.id, quantity);
            toast({
              message: `${quantity} × ${productName} (${selected.name}) added to your order.`,
              action: { label: "View order", onClick: () => router.push("/cart") },
            });
          }}
          disabled={!locationId || inventoryError || selectedInStock !== true}
          className="btn btn-primary btn-block min-h-14 rounded-full text-base sm:text-lg"
        >
          {!locationId
            ? "Choose a pickup location"
            : inventoryError
              ? "Stock check unavailable"
            : selectedInStock == null
              ? "Checking stock…"
              : selectedInStock === false
                ? "Sold out at this location"
                : <>Add to order &middot; {formatMoney(totalCents, selected.currency)}</>}
        </button>
      </div>

      <p className="bg-accent-soft text-accent-ink rounded-[1.25rem] px-4 py-3 text-xs leading-relaxed">
        {leadTimeDays > 0
          ? `Order at least ${leadTimeDays} day${leadTimeDays === 1 ? "" : "s"} ahead`
          : "Same-day ordering is available"}
        {` before ${formatPickupTime(orderCutoffTime)}. Pickup is confirmed at checkout.`}
      </p>

      {inventoryError ? (
        <p
          role="alert"
          className="border-danger/20 bg-danger-soft text-danger flex flex-wrap items-center gap-2 rounded-[1.25rem] border px-4 py-3 text-sm"
        >
          We couldn&rsquo;t check this store&rsquo;s stock.
          <button
            type="button"
            onClick={() => {
              setInventoryErrorLocation(null);
              setInventoryAttempt((attempt) => attempt + 1);
            }}
            className="link"
          >
            Try again
          </button>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Per-piece price, where the variant name states a piece count.
 *
 * Names come from Square and follow the bakery's own convention — "25 pcs Ube",
 * "Big - 78 pcs". Anything that doesn't parse simply doesn't get the line,
 * rather than getting a wrong one.
 */
function pricePerPiece(variant: CatalogVariant): number | null {
  const match = /(\d+)\s*pcs?\b/i.exec(variant.name);
  const pieces = match ? Number(match[1]) : 0;
  if (!pieces) return null;

  return Math.round(variant.priceCents / pieces);
}
