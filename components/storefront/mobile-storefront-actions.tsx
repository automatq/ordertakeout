"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { BagIcon, MapPinIcon, PhoneIcon } from "@/components/ui/icons";
import { useCart } from "@/lib/cart/store";
import {
  pickupLocationDirections,
  type PickupLocationDirections,
} from "@/lib/locations/directions";
import { usePickupLocation } from "@/lib/locations/store";
import type { StoreLocation } from "@/lib/locations/types";
import { STORE_INFO } from "@/lib/store";

/** Apple Maps is meaningful only on Apple platforms; iPadOS can identify as Mac. */
function isApplePlatform(userAgent: string) {
  return /iP(hone|ad|od)|Macintosh/.test(userAgent);
}

const subscribeToPlatform = () => () => {};
const getApplePlatform = () => isApplePlatform(window.navigator.userAgent);
const getServerApplePlatform = () => false;

/**
 * Persistent mobile customer actions, adapted from the Medspa GPS chooser.
 *
 * The picker deliberately follows the branch chosen in `LocationSelector`.
 * It never asks for device geolocation: the external map app gets only the
 * pickup destination and may offer its own location permission as usual.
 */
export function MobileStorefrontActions({ locations }: { locations: StoreLocation[] }) {
  const pathname = usePathname();
  const { locationId } = usePickupLocation();
  const { ready, totalQuantity } = useCart();
  const showAppleMaps = useSyncExternalStore(
    subscribeToPlatform,
    getApplePlatform,
    getServerApplePlatform,
  );

  const location = locations.find((candidate) => candidate.id === locationId) ?? null;
  const directions = location ? pickupLocationDirections(location) : null;
  const isCheckout = pathname === "/checkout";

  if (isCheckout) return null;

  const cartLabel = ready && totalQuantity > 0
    ? `Cart, ${totalQuantity} item${totalQuantity === 1 ? "" : "s"}`
    : "Cart";

  return (
    <div
      className="bg-canvas/95 border-border shadow-sticky fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-xl lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <nav aria-label="Quick actions" className="shell grid grid-cols-3 gap-2 py-2">
        <DirectionsAction
          key={`${pathname}:${locationId ?? "none"}`}
          directions={directions}
          locationName={location?.name ?? "your pickup location"}
          showAppleMaps={showAppleMaps}
        />

        <a
          href={STORE_INFO.phoneHref}
          className="border-border-strong text-ink hover:border-brand hover:text-brand flex min-h-11 items-center justify-center gap-1.5 rounded-pill border px-2 text-xs font-medium transition-colors"
        >
          <PhoneIcon className="h-4 w-4" />
          <span>Call</span>
        </a>

        <Link
          href="/cart"
          aria-label={cartLabel}
          className="bg-brand text-brand-ink hover:bg-brand-hover flex min-h-11 items-center justify-center gap-1.5 rounded-pill px-2 text-xs font-medium transition-colors"
        >
          <BagIcon className="h-4 w-4" />
          <span>Cart</span>
          {ready && totalQuantity > 0 ? (
            <span aria-hidden className="bg-brand-ink text-brand inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[0.6875rem] font-semibold tabular-nums">
              {totalQuantity}
            </span>
          ) : null}
        </Link>
      </nav>
    </div>
  );
}

function DirectionsAction({
  directions,
  locationName,
  showAppleMaps,
}: {
  directions: PickupLocationDirections | null;
  locationName: string;
  showAppleMaps: boolean;
}) {
  const [gpsOpen, setGpsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const gpsToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!gpsOpen) return;

    const closeWhenOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setGpsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setGpsOpen(false);
      gpsToggleRef.current?.focus();
    };

    document.addEventListener("mousedown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [gpsOpen]);

  return (
    <div ref={menuRef} className="relative">
      <button
        ref={gpsToggleRef}
        type="button"
        disabled={!directions}
        onClick={() => setGpsOpen((open) => !open)}
        aria-expanded={gpsOpen}
        aria-controls={directions ? "pickup-directions" : undefined}
        aria-describedby={directions ? undefined : "gps-location-help"}
        className="border-border-strong text-ink hover:border-brand hover:text-brand flex min-h-11 w-full items-center justify-center gap-1.5 rounded-pill border px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        <MapPinIcon className="h-4 w-4" />
        <span>{directions ? "GPS" : "Select store"}</span>
      </button>
      {!directions ? (
        <span id="gps-location-help" className="sr-only">
          Choose a pickup location to get directions.
        </span>
      ) : null}
      {gpsOpen && directions ? (
        <div
          id="pickup-directions"
          role="menu"
          aria-label={`Directions to ${locationName}`}
          className="bg-surface border-border shadow-raised absolute bottom-[calc(100%+0.5rem)] left-0 z-10 grid min-w-44 gap-1 rounded-card border p-1.5"
        >
          <DirectionsLink href={directions.googleMaps}>Google Maps</DirectionsLink>
          <DirectionsLink href={directions.waze}>Waze</DirectionsLink>
          {showAppleMaps ? <DirectionsLink href={directions.appleMaps}>Apple Maps</DirectionsLink> : null}
        </div>
      ) : null}
    </div>
  );
}

function DirectionsLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      role="menuitem"
      className="text-ink hover:bg-surface-sunken flex min-h-11 items-center rounded-control px-3 text-sm transition-colors"
    >
      {children}
    </a>
  );
}
