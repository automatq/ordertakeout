"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { useToast } from "@/components/ui/toast";
import { useCart } from "@/lib/cart/store";
import { getVariantInventory } from "@/app/actions/locations";
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
  const [availabilityState, setAvailabilityState] = useState<{ locationId: string; values: Record<string, number> } | null>(null);
  const [inventoryErrorLocation, setInventoryErrorLocation] = useState<string | null>(null);
  const [inventoryAttempt, setInventoryAttempt] = useState(0);
  useEffect(() => {
    if (!locationId) return;
    let canceled = false;
    void getVariantInventory({
      locationId,
      variantIds: variants.map((variant) => variant.id),
    })
      .then((values) => {
        if (!canceled) {
          setAvailabilityState({ locationId, values });
          setInventoryErrorLocation(null);
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

  const selectedStock = availability?.[selected.id];
  const selectedMax = Math.max(1, Math.min(MAX_QUANTITY, selectedStock ?? MAX_QUANTITY));
  const totalCents = selected.priceCents * quantity;

  return (
    <div className="card flex flex-col gap-5 p-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="text-ink-subtle text-sm font-semibold tracking-wide uppercase">
          Choose a size
        </legend>

        <div className="flex flex-col gap-2 pt-1">
          {variants.map((variant) => {
            const perPiece = pricePerPiece(variant);
            const stock = availability?.[variant.id];

            return (
              <label key={variant.id} className={`radio-card ${stock === 0 ? "opacity-50" : ""}`}>
                <span className="flex items-center gap-3">
                  {/* Visually hidden rather than removed: the native control is
                      what makes this a real radio group for keyboard and
                      assistive tech. `.radio-card` mirrors its focus ring. */}
                  <input
                    type="radio"
                    name="variant"
                    value={variant.id}
                    checked={variant.id === variantId}
                    disabled={stock === 0}
                    onChange={() => setVariantId(variant.id)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                      variant.id === variantId
                        ? "border-brand bg-brand"
                        : "border-border-strong"
                    }`}
                  >
                    {variant.id === variantId ? (
                      <span className="bg-brand-ink h-1.5 w-1.5 rounded-full" />
                    ) : null}
                  </span>
                  <span className="text-ink font-medium">{variant.name}</span>
                  {stock === 0 ? <span className="text-danger text-xs">Sold out here</span> : null}
                </span>

                <span className="text-right">
                  <span className="text-ink font-display block text-xl font-normal">
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <QuantityStepper
          label={`Quantity of ${selected.name}`}
          value={quantity}
          min={1}
          max={selectedMax}
          onChange={setQuantity}
          onClamp={(attempted) =>
            toast({
              tone: "info",
              message: `You can order up to ${selectedMax} of this tray here — we've set it to ${selectedMax}. For ${attempted}, please call the store.`,
            })
          }
        />

        <button
          type="button"
          onClick={() => {
            if (!locationId) { toast({ tone: "info", message: "Choose a pickup location before adding items." }); return; }
            if (selectedStock == null || selectedStock < quantity) return;
            add(selected.id, quantity);
            toast({
              message: `${quantity} × ${productName} (${selected.name}) added to your order.`,
              action: { label: "View order", onClick: () => router.push("/cart") },
            });
          }}
          disabled={!locationId || inventoryError || selectedStock == null || selectedStock < quantity}
          className="btn btn-primary flex-1"
        >
          {!locationId
            ? "Choose a pickup location"
            : inventoryError
              ? "Stock check unavailable"
            : selectedStock == null
              ? "Checking stock…"
              : selectedStock === 0
                ? "Sold out at this location"
                : selectedStock < quantity
                  ? `Only ${selectedStock} available`
                  : <>Add to order &middot; {formatMoney(totalCents, selected.currency)}</>}
        </button>
      </div>

      <p className="text-ink-subtle text-xs">
        {leadTimeDays > 0
          ? `Order at least ${leadTimeDays} day${leadTimeDays === 1 ? "" : "s"} ahead`
          : "Same-day ordering is available"}
        {` before ${formatPickupTime(orderCutoffTime)}. Pickup is confirmed at checkout.`}
      </p>

      {inventoryError ? (
        <p role="alert" className="field-error flex flex-wrap items-center gap-2">
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
