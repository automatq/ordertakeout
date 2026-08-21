"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { getPickupLocations, reconcileCartForLocation, type CartReconciliation } from "@/app/actions/locations";
import { MapPinIcon } from "@/components/ui/icons";
import type { StoreLocation } from "@/lib/locations/types";
import { usePickupLocation } from "@/lib/locations/store";
import { distanceKm, recommendPickupLocation } from "@/lib/locations/distance";
import { useCart } from "@/lib/cart/store";
import { cartSnapshotsMatch, retainCartVariants, type CartItem } from "@/lib/catalog/cart";
import { STORE_INFO } from "@/lib/store";

export function LocationSelector({
  compact = false,
  initialLocations = [],
}: {
  compact?: boolean;
  initialLocations?: StoreLocation[];
}) {
  const { locationId, lockedLocationId, setLocation } = usePickupLocation();
  const { items, locationId: cartLocationId, reconcileLocation } = useCart();
  const pathname = usePathname();
  const [locations, setLocations] = useState<StoreLocation[]>(initialLocations);
  const [locationsLoading, setLocationsLoading] = useState(initialLocations.length === 0);
  const [locationsError, setLocationsError] = useState(false);
  const [locationsAttempt, setLocationsAttempt] = useState(0);
  const [recommendation, setRecommendation] = useState<{ location: StoreLocation; distance: number } | null>(null);
  const [recommendationMessage, setRecommendationMessage] = useState<string | null>(null);
  const [pendingChange, setPendingChange] = useState<{
    location: StoreLocation;
    reconciliation: CartReconciliation;
    cartSnapshot: CartItem[];
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (initialLocations.length === 0) {
      let canceled = false;
      void getPickupLocations()
        .then((result) => {
          if (canceled) return;
          if (result.ok && result.locations.length > 0) {
            setLocations(result.locations);
            setLocationsError(false);
          } else {
            setLocations([]);
            setLocationsError(true);
          }
        })
        .catch(() => {
          if (!canceled) {
            setLocations([]);
            setLocationsError(true);
          }
        })
        .finally(() => {
          if (!canceled) setLocationsLoading(false);
        });
      return () => { canceled = true; };
    }
  }, [initialLocations.length, locationsAttempt]);

  useEffect(() => {
    if (locationId && items.length === 0 && cartLocationId !== locationId) {
      reconcileLocation(locationId, []);
    }
  }, [cartLocationId, items.length, locationId, reconcileLocation]);

  useEffect(() => {
    if (locationId && items.length > 0 && cartLocationId !== locationId && !pendingChange) {
      requestLocation(locationId);
    }
  // Re-run when a transiently empty location list recovers; otherwise a
  // persisted selection can remain mismatched with the cart's old branch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartLocationId, locationId, items, locations, pendingChange]);

  const selected = locations.find((location) => location.id === locationId);
  const selectionRequired = !selected && !pathname.startsWith("/orders");

  function requestLocation(nextId: string) {
    const next = locations.find((location) => location.id === nextId);
    if (!next || (next.id === locationId && cartLocationId === next.id)) return;
    if (lockedLocationId && next.id !== lockedLocationId) {
      setRecommendationMessage("Your pickup location is locked while your reserved time is held.");
      return;
    }
    if (items.length === 0) {
      if (!setLocation(next.id)) {
        setRecommendationMessage("Your pickup location is locked while your reserved time is held.");
        return;
      }
      reconcileLocation(next.id, []);
      return;
    }
    startTransition(async () => {
      try {
        const reconciliation = await reconcileCartForLocation({ locationId: next.id, items });
        if (!reconciliation) {
          setRecommendationMessage("We couldn't verify inventory at that location. Please try again.");
          return;
        }
        setPendingChange({
          location: next,
          reconciliation,
          cartSnapshot: items.map((item) => ({ ...item })),
        });
      } catch {
        setRecommendationMessage("We couldn't verify inventory at that location. Please try again.");
      }
    });
  }

  function confirmLocationChange() {
    if (!pendingChange) return;
    if (!cartSnapshotsMatch(items, pendingChange.cartSnapshot)) {
      const nextLocationId = pendingChange.location.id;
      setPendingChange(null);
      setRecommendationMessage(
        "Your cart changed while we checked inventory. Please review the updated availability before switching.",
      );
      requestLocation(nextLocationId);
      return;
    }
    if (!setLocation(pendingChange.location.id)) {
      setPendingChange(null);
      setRecommendationMessage("Your pickup location is locked while your reserved time is held.");
      return;
    }
    const retained = retainCartVariants(
      pendingChange.cartSnapshot,
      pendingChange.reconciliation.retainedVariantIds,
    );
    reconcileLocation(pendingChange.location.id, retained);
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
    <div className={compact ? "location-strip" : "location-picker"}>
      <span className="location-strip-icon">
        <MapPinIcon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <span className="location-strip-kicker block text-[0.6875rem] font-semibold tracking-[0.12em] uppercase">
          Picking up at
        </span>
        <strong className="location-strip-name block truncate text-sm font-semibold sm:hidden">
          {selected ? shortLocationName(selected.name) : "Choose a bakery"}
        </strong>
        <strong className="location-strip-name hidden truncate text-base font-semibold sm:block">
          {selected?.name ?? "Choose a bakery"}
        </strong>
        {selected ? (
          <span className="location-strip-address hidden truncate text-xs sm:block">
            {selected.address}{selected.city ? `, ${selected.city}` : ""}
          </span>
        ) : null}
      </div>
      <label className="shrink-0">
        <span className="sr-only">Change pickup location</span>
        <select
          value={locationId ?? ""}
          onChange={(event) => requestLocation(event.target.value)}
          disabled={isPending || locations.length === 0 || lockedLocationId !== null}
          className="location-strip-select"
          aria-label="Change pickup location"
          title={lockedLocationId ? "Pickup location is locked while your reserved time is held" : undefined}
        >
          <option value="">Choose a store</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>{shortLocationName(location.name)}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={recommendFromDevice}
        disabled={isPending || locations.length === 0 || lockedLocationId !== null || recommendationMessage === "Finding the closest pickup location…"}
        className="btn btn-ghost btn-sm hidden sm:inline-flex"
      >
        Recommend nearest
      </button>
      {recommendation ? (
        <button type="button" disabled={lockedLocationId !== null} onClick={() => requestLocation(recommendation.location.id)} className="btn btn-secondary btn-sm w-full lg:w-auto">
          Recommended: {recommendation.location.name} ({recommendation.distance.toFixed(1)} km)
        </button>
      ) : null}
      {lockedLocationId ? <span role="status" className="text-secondary-ink/80 w-full text-xs">Pickup location locked while your reserved time is held.</span> : null}
      {recommendationMessage ? <span role="status" className="text-ink-subtle w-full text-xs">{recommendationMessage}</span> : null}
    </div>
  );

  return (
    <>
      {!selectionRequired ? picker : null}
      {selectionRequired ? (
        <LocationDialog labelledBy="location-required-heading">
          <div className="border-brand/15 bg-brand-tint -m-6 mb-0 rounded-t-[2rem] border-b p-6 sm:-m-8 sm:mb-0 sm:p-8">
            <span className="text-secondary text-xs font-semibold tracking-[0.14em] uppercase">Pickup only</span>
            <h2 id="location-required-heading" className="font-display text-brand mt-2 text-4xl font-normal uppercase sm:text-5xl">Where will you pick up?</h2>
            <p className="text-ink-muted mt-2 text-sm sm:text-base">Choose a bakery first. Its live inventory and pickup times will follow you through checkout.</p>
          </div>
          <div className="grid gap-3">
            {locations.map((location, index) => (
              <button
                key={location.id}
                type="button"
                data-autofocus={index === 0 ? "true" : undefined}
                onClick={() => requestLocation(location.id)}
                disabled={isPending || lockedLocationId !== null}
                className="location-choice"
              >
                <span className="location-choice-icon"><MapPinIcon className="h-5 w-5" /></span>
                <span className="min-w-0 text-left">
                  <strong className="font-display text-ink block text-2xl font-normal uppercase">{location.name}</strong>
                  <span className="text-ink-muted block text-sm">{location.address}{location.city ? `, ${location.city}` : ""}</span>
                </span>
              </button>
            ))}
          </div>
          {locationsLoading ? (
            <p role="status" className="panel text-ink-muted p-4 text-center text-sm">
              Loading pickup locations…
            </p>
          ) : null}
          {locationsError ? (
            <div role="alert" className="panel border-danger/30 flex flex-col gap-3 p-4 text-sm">
              <p className="text-ink">We couldn&rsquo;t load the bakery locations right now.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setLocationsLoading(true);
                    setLocationsError(false);
                    setLocationsAttempt((attempt) => attempt + 1);
                  }}
                  className="btn btn-primary btn-sm"
                >
                  Try again
                </button>
                <a href={STORE_INFO.phoneHref} className="btn btn-secondary btn-sm">
                  Call {STORE_INFO.phone}
                </a>
              </div>
            </div>
          ) : null}
          <button type="button" onClick={recommendFromDevice} disabled={isPending || locations.length === 0 || lockedLocationId !== null || recommendationMessage === "Finding the closest pickup location…"} className="btn btn-secondary btn-block">
            <MapPinIcon className="h-4 w-4" />
            Recommend the nearest shop
          </button>
          {recommendation ? (
            <button type="button" disabled={lockedLocationId !== null} onClick={() => requestLocation(recommendation.location.id)} className="btn btn-primary btn-block">
              Use {recommendation.location.name} — {recommendation.distance.toFixed(1)} km away
            </button>
          ) : null}
          {recommendationMessage ? <p role="status" className="text-ink-muted text-center text-sm">{recommendationMessage}</p> : null}
        </LocationDialog>
      ) : null}
      {pendingChange ? (
        <LocationDialog labelledBy="location-change-heading" onDismiss={() => setPendingChange(null)} compact>
            <div>
              <span className="text-secondary text-xs font-semibold tracking-[0.14em] uppercase">Your cart</span>
              <h2 id="location-change-heading" className="font-display text-brand mt-2 text-4xl font-normal uppercase">Change pickup location?</h2>
              <p className="text-ink-muted mt-1 text-sm">Your order will move to {pendingChange.location.name}.</p>
            </div>
            {pendingChange.reconciliation.removed.length ? (
              <div className="panel border-danger/30 p-4">
                <p className="text-ink text-sm font-semibold">These items will be removed:</p>
                <ul className="text-ink-muted mt-2 list-disc pl-5 text-sm">
                  {pendingChange.reconciliation.removed.map((item) => (
                    <li key={item.variantId}>
                      {item.name} — {item.reason === "insufficient"
                        ? "not enough stock for your requested quantity"
                        : "not available at this location"}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="panel p-4 text-sm text-ink-muted">Everything in your order is stocked at this location.</p>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" data-autofocus onClick={() => setPendingChange(null)} className="btn btn-secondary btn-sm">Keep current location</button>
              <button type="button" onClick={confirmLocationChange} className="btn btn-primary btn-sm">Change location</button>
            </div>
        </LocationDialog>
      ) : null}
    </>
  );
}

function shortLocationName(name: string): string {
  const pieces = name.split(/\s+[—–-]\s+/);
  return pieces.at(-1)?.trim() || name;
}

function LocationDialog({
  labelledBy,
  onDismiss,
  compact = false,
  children,
}: {
  labelledBy: string;
  onDismiss?: () => void;
  compact?: boolean;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.querySelector<HTMLElement>("[data-autofocus], button, select")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && onDismissRef.current) {
        event.preventDefault();
        onDismissRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialog?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), select:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div className="location-dialog-backdrop" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`location-dialog-sheet ${compact ? "max-w-lg" : "max-w-2xl"}`}
      >
        {children}
      </div>
    </div>
  );
}
