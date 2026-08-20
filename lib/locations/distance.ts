import type { StoreLocation } from "./types";

type Coordinates = { latitude: number; longitude: number };

/** Nearest location by great-circle distance; returns null when Square lacks coordinates. */
export function recommendPickupLocation(
  origin: Coordinates,
  locations: readonly StoreLocation[],
): StoreLocation | null {
  let recommendation: StoreLocation | null = null;
  let shortest = Number.POSITIVE_INFINITY;
  for (const location of locations) {
    if (!location.coordinates) continue;
    const distance = distanceKm(origin, location.coordinates);
    if (distance < shortest) {
      shortest = distance;
      recommendation = location;
    }
  }
  return recommendation;
}

export function distanceKm(a: Coordinates, b: Coordinates): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitude = radians(b.latitude - a.latitude);
  const longitude = radians(b.longitude - a.longitude);
  const value = Math.sin(latitude / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(longitude / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
