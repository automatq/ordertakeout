"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowRightIcon, BagIcon, LoafIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useCart } from "@/lib/cart/store";
import { usePickupLocation } from "@/lib/locations/store";
import { resolveCart } from "@/lib/catalog/cart";
import { primaryImage, sizedImage } from "@/lib/catalog/images";
import type { CatalogProduct } from "@/lib/catalog/types";
import { formatMoney } from "@/lib/square/money";
import { getVariantInventory } from "@/app/actions/locations";

/**
 * The cart.
 *
 * The line rows were a single `flex items-center justify-between` with a right
 * cluster of quantity input, line total and Remove — which crowded to the point
 * of overlapping at 375px. They stack on mobile now and carry a thumbnail, so
 * the customer can see what they're buying rather than reading its name.
 *
 * Removal is undoable. It used to be a one-tap, unconfirmed, unrecoverable
 * action whose accessible name was the bare word "Remove", with no indication
 * of which item it belonged to.
 */
export function CartView({ products }: { products: CatalogProduct[] }) {
  const { items, ready, setQuantity, remove, add } = useCart();
  const { locationId } = usePickupLocation();
  const [inventoryState, setInventoryState] = useState<{
    locationId: string;
    values: Record<string, number>;
  } | null>(null);
  const [inventoryErrorLocation, setInventoryErrorLocation] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!locationId || !items.length) return;
    let canceled = false;
    void getVariantInventory({
      locationId,
      variantIds: items.map((item) => item.variantId),
    })
      .then((values) => {
        if (!canceled) {
          setInventoryState({ locationId, values });
          setInventoryErrorLocation(null);
        }
      })
      .catch(() => {
        if (!canceled) {
          setInventoryState(null);
          setInventoryErrorLocation(locationId);
        }
      });
    return () => { canceled = true; };
  }, [items, locationId]);

  // A skeleton rather than `null`: on a slow client the page used to render a
  // heading followed by nothing at all.
  if (!ready) {
    return (
      <div role="status" aria-busy className="flex flex-col gap-3">
        <span className="sr-only">Loading your order</span>
        {Array.from({ length: 2 }, (_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<BagIcon className="h-6 w-6" />}
        title="Your order is empty"
        description="Party trays are baked to order, so pick a tray and a pickup time and we'll have it ready for you."
        action={{ label: "Browse party trays", href: "/#trays" }}
      />
    );
  }

  if (!locationId) {
    return <div role="alert" className="panel p-5 text-sm text-ink-muted">Choose a pickup location above before continuing with your order.</div>;
  }

  const resolved = resolveCart(items, products);
  const inventory = inventoryState?.locationId === locationId ? inventoryState.values : null;
  const inventoryError = inventoryErrorLocation === locationId;

  return (
    <div className="flex flex-col gap-6">
      {!resolved.ok ? (
        <div role="alert" className="panel border-danger/30 flex flex-col gap-3 p-5">
          <p className="text-ink text-sm">
            {resolved.unknownVariantIds.length === 1 ? "An item" : "Some items"} in your
            order {resolved.unknownVariantIds.length === 1 ? "is" : "are"} no longer
            available. The rest of your order is still here.
          </p>
          <button
            type="button"
            onClick={() => resolved.unknownVariantIds.forEach(remove)}
            className="btn btn-primary btn-sm self-start"
          >
            Remove unavailable {resolved.unknownVariantIds.length === 1 ? "item" : "items"}
          </button>
        </div>
      ) : null}

      <ul className="flex flex-col gap-3">
        {resolved.lines.map((line) => {
          const image = primaryImage(line.product);
          const available = inventory?.[line.variant.id];

          return (
            <li key={line.variant.id} className="card flex gap-4 p-4">
              <div className="bg-surface-sunken rounded-control text-brand/30 relative h-20 w-20 shrink-0 overflow-hidden">
                {image ? (
                  <Image
                    src={sizedImage(image, 160)}
                    alt=""
                    fill
                    sizes="80px"
                    className="object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center">
                    <LoafIcon className="h-8 w-8" />
                  </span>
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-ink font-medium">{line.product.name}</p>
                    <p className="text-ink-muted text-sm">{line.variant.name}</p>
                    <p className="text-ink-subtle text-sm">
                      {formatMoney(line.variant.priceCents, line.variant.currency)} each
                    </p>
                  </div>
                  <span className="text-ink font-display shrink-0 text-xl font-normal">
                    {formatMoney(line.lineTotalCents, line.variant.currency)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <QuantityStepper
                    size="sm"
                    label={`Quantity of ${line.product.name}, ${line.variant.name}`}
                    value={line.quantity}
                    max={Math.max(1, Math.min(50, available ?? 50))}
                    onChange={(quantity) => setQuantity(line.variant.id, quantity)}
                  />

                  {available != null && line.quantity > available ? (
                    <span className="text-danger text-sm" role="alert">
                      Only {available} available at this location
                    </span>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => {
                      const { id } = line.variant;
                      const { quantity } = line;
                      remove(id);
                      toast({
                        tone: "info",
                        message: `${line.product.name} — ${line.variant.name} removed.`,
                        action: { label: "Undo", onClick: () => add(id, quantity) },
                      });
                    }}
                    /* The accessible name used to be the bare word "Remove",
                       repeated once per row. */
                    aria-label={`Remove ${line.product.name}, ${line.variant.name}, from your order`}
                    className="text-ink-subtle hover:text-danger text-sm underline underline-offset-2 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="card flex flex-col gap-3 p-5">
        <div className="text-ink-muted flex items-baseline justify-between text-sm">
          <span>Subtotal</span>
          <span className="tabular-nums">
            {formatMoney(resolved.subtotalCents, resolved.currency)}
          </span>
        </div>
        <div className="text-ink-muted flex items-baseline justify-between text-sm">
          <span>Taxes</span>
          {/* Square applies tax at the point of payment from the location's own
              settings, so the exact figure isn't ours to compute here. Saying so
              beats a "Total" that quietly changes on the payment screen. */}
          <span>Calculated at payment</span>
        </div>
        <div className="border-border text-ink flex items-baseline justify-between border-t pt-3 text-lg font-semibold">
          <span>Estimated total before tax</span>
          <span className="font-display text-2xl font-normal">
            {formatMoney(resolved.subtotalCents, resolved.currency)}
          </span>
        </div>
      </div>

      {inventoryError ? (
        <p role="status" className="panel p-4 text-sm text-ink-muted">
          We couldn&rsquo;t refresh this store&rsquo;s stock. Checkout will verify every item before payment.
        </p>
      ) : null}

      {!resolved.ok ? (
        <p role="status" className="panel p-4 text-sm text-ink-muted">
          Remove the unavailable {resolved.unknownVariantIds.length === 1 ? "item" : "items"} before checkout.
        </p>
      ) : inventory && resolved.lines.some((line) => line.quantity > (inventory[line.variant.id] ?? 0)) ? (
        <p role="alert" className="panel border-danger/30 p-4 text-sm text-danger">
          Adjust or remove the items above before choosing a pickup time.
        </p>
      ) : (
        <Link href="/checkout" className="btn btn-primary btn-block sm:w-auto sm:self-start">
          Choose pickup time
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}
