"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname } from "next/navigation";

import { getPickupLocations, reconcileCartForLocation, type CartReconciliation } from "@/app/actions/locations";
import type { StoreLocation } from "@/lib/locations/types";
import { usePickupLocation } from "@/lib/locations/store";
import { distanceKm, recommendPickupLocation } from "@/lib/locations/distance";
import { useCart } from "@/lib/cart/store";

export function LocationSelector({
  compact = false,
  initialLocations = [],
}: {
  compact?: boolean;
  initialLocations?: StoreLocation[];
}) {
  const { locationId, setLocation } = usePickupLocation();
  const { items, locationId: cartLocationId, reconcileLocation } = useCart();
  const pathname = usePathname();
  const [locations, setLocations] = useState<StoreLocation[]>(initialLocations);
  const [recommendation, setRecommendation] = useState<{ location: StoreLocation; distance: number } | null>(null);
  const [recommendationMessage, setRecommendationMessage] = useState<string | null>(null);
  const [pendingChange, setPendingChange] = useState<{
    location: StoreLocation;
    reconciliation: CartReconciliation;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (initialLocations.length === 0) {
      void getPickupLocations().then(setLocations).catch(() => setLocations([]));
    }
  }, [initialLocations.length]);

  useEffect(() => {
    if (locationId && items.length === 0 && cartLocationId !== locationId) {
      reconcileLocation(locationId, []);
    }
  }, [cartLocationId, items.length, locationId, reconcileLocation]);

  useEffect(() => {
    if (locationId && items.length > 0 && cartLocationId !== locationId && !pendingChange) {
      requestLocation(locationId);
    }
  // Cart contents are intentionally represented by their stable ids/quantities.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartLocationId, locationId, items, pendingChange]);

  const selected = locations.find((location) => location.id === locationId);
  const selectionRequired = (!locationId || (!selected && locations.length > 0))
    && !pathname.startsWith("/orders");

  function requestLocation(nextId: string) {
    const next = locations.find((location) => location.id === nextId);
    if (!next || (next.id === locationId && cartLocationId === next.id)) return;
    if (items.length === 0) {
      reconcileLocation(next.id, []);
      setLocation(next.id);
      return;
    }
    startTransition(async () => {
      const reconciliation = await reconcileCartForLocation({ locationId: next.id, items });
      if (!reconciliation) {
        setRecommendationMessage("We couldn't verify inventory at that location. Please try again.");
        return;
      }
      setPendingChange({ location: next, reconciliation });
    });
  }

  function confirmLocationChange() {
    if (!pendingChange) return;
    const retained = items.filter((item) =>
      pendingChange.reconciliation.retainedVariantIds.includes(item.variantId),
    );
    reconcileLocation(pendingChange.location.id, retained);
    setLocation(pendingChange.location.id);
    setPendingChange(null);
  }

  function recommendFromDevice() {
    if (!navigator.geolocation) {
      setRecommendationMessage("Location services are unavailable in this browser.");
      return;
    }
    setRecommendationMessage("Finding the closest pickup location…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const nearest = recommendPickupLocation(coords, locations);
        if (!nearest) { setRecommendationMessage("We need map coordinates for each store before we can recommend one."); return; }
        const distance = nearest.coordinates
          ? distanceKm(coords, nearest.coordinates)
          : 0;
        setRecommendation({ location: nearest, distance });
        setRecommendationMessage(null);
      },
      () => setRecommendationMessage("We couldn’t access your location. You can still choose a pickup location."),
      { enableHighAccuracy: false, maximumAge: 15 * 60_000, timeout: 10_000 },
    );
  }
  const picker = (
    <div className={compact ? "text-ink-muted flex flex-wrap items-center gap-2 text-sm" : "card flex flex-col gap-2 p-4"}>
      <label className="contents">
      <span className="text-ink text-sm font-semibold">Pickup location</span>
      <select
        value={locationId ?? ""}
        onChange={(event) => requestLocation(event.target.value)}
        disabled={isPending || locations.length === 0}
        className="input max-w-md"
        aria-label="Pickup location"
      >
        <option value="">Choose your pickup location</option>
        {locations.map((location) => <option key={location.id} value={location.id}>{location.name} — {location.address}</option>)}
      </select>
      </label>
      <button type="button" onClick={recommendFromDevice} disabled={isPending || locations.length === 0 || recommendationMessage === "Finding the closest pickup location…"} className="btn btn-ghost btn-sm">Recommend nearest</button>
      {recommendation ? <button type="button" onClick={() => requestLocation(recommendation.location.id)} className="text-brand text-sm font-medium underline underline-offset-2">Recommended: {recommendation.location.name} ({recommendation.distance.toFixed(1)} km away)</button> : null}
      {recommendationMessage ? <span role="status" className="text-ink-subtle text-xs">{recommendationMessage}</span> : null}
      {!compact && selected ? <span className="text-ink-muted text-sm">Collect from {selected.address}{selected.city ? `, ${selected.city}` : ""}.</span> : null}
    </div>
  );

  return (
    <>
      {!selectionRequired ? picker : null}
      {selectionRequired ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="location-required-heading">
          <div className="card flex w-full max-w-xl flex-col gap-4 p-6 shadow-raised">
            <div>
              <h2 id="location-required-heading" className="font-display text-ink text-3xl font-normal uppercase">Where will you pick up?</h2>
              <p className="text-ink-muted mt-1 text-sm">Choose a store to see the products and pickup times available there.</p>
            </div>
            {picker}
          </div>
        </div>
      ) : null}
      {pendingChange ? (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="location-change-heading">
          <div className="card flex w-full max-w-lg flex-col gap-4 p-6 shadow-raised">
            <div>
              <h2 id="location-change-heading" className="text-ink text-lg font-semibold">Change pickup location?</h2>
              <p className="text-ink-muted mt-1 text-sm">Your order will move to {pendingChange.location.name}.</p>
            </div>
            {pendingChange.reconciliation.removed.length ? (
              <div className="panel border-danger/30 p-4">
                <p className="text-ink text-sm font-semibold">These items will be removed:</p>
                <ul className="text-ink-muted mt-2 list-disc pl-5 text-sm">
                  {pendingChange.reconciliation.removed.map((item) => (
                    <li key={item.variantId}>{item.name} — requested {item.requested}, available {item.available}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="panel p-4 text-sm text-ink-muted">Everything in your order is stocked at this location.</p>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => setPendingChange(null)} className="btn btn-secondary btn-sm">Keep current location</button>
              <button type="button" onClick={confirmLocationChange} className="btn btn-primary btn-sm">Change location</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
