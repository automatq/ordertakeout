import type { StoreLocation } from "./types";

export interface PickupLocationDirections {
  googleMaps: string;
  waze: string;
  appleMaps: string;
}

/**
 * Navigation deep links for a Square pickup location.
 *
 * Coordinates make an unambiguous destination when Square supplies them. An
 * address remains a useful fallback for older or incompletely configured
 * locations, so customers can still hand navigation off to their preferred
 * app without the browser requesting their current location.
 */
export function pickupLocationDirections(location: StoreLocation): PickupLocationDirections {
  const destination = location.coordinates
    ? `${location.coordinates.latitude},${location.coordinates.longitude}`
    : [location.address, location.city].filter(Boolean).join(", ");
  const encodedDestination = encodeURIComponent(destination);

  return {
    googleMaps: `https://www.google.com/maps/dir/?api=1&destination=${encodedDestination}`,
    waze: `https://waze.com/ul?q=${encodedDestination}&navigate=yes`,
    appleMaps: `https://maps.apple.com/?daddr=${encodedDestination}&dirflg=d`,
  };
}
