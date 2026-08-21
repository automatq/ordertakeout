import type { Square } from "square";

import type { StoreLocation } from "./types";

/**
 * Normalize one Square location without depending on the Next.js server runtime.
 *
 * Keeping this mapper in a plain module lets operational scripts validate a
 * location with exactly the same rules as the storefront while preserving the
 * `server-only` boundary around credentials and cached application queries.
 */
export function mapSquareLocation(location: Square.Location): StoreLocation | null {
  if (!location.id || location.status !== "ACTIVE") return null;

  const address = location.address;
  const addressLine = [address?.addressLine1, address?.addressLine2].filter(Boolean).join(", ");

  return {
    id: location.id,
    name: location.name?.trim() || "Pickup location",
    address: addressLine || "Address available at checkout",
    city:
      [address?.locality, address?.administrativeDistrictLevel1, address?.postalCode]
        .filter(Boolean)
        .join(", ") || null,
    timezone: location.timezone ?? null,
    currency: location.currency ?? null,
    phone: location.phoneNumber?.trim() || null,
    businessHours: (location.businessHours?.periods ?? []).flatMap((period) =>
      period.dayOfWeek && period.startLocalTime && period.endLocalTime
        ? [
            {
              dayOfWeek: period.dayOfWeek,
              startTime: period.startLocalTime.slice(0, 5),
              endTime: period.endLocalTime.slice(0, 5),
            },
          ]
        : [],
    ),
    coordinates:
      location.coordinates?.latitude != null && location.coordinates.longitude != null
        ? {
            latitude: location.coordinates.latitude,
            longitude: location.coordinates.longitude,
          }
        : null,
  };
}

/** Validate a browser/configured id against Square's current active locations. */
export function findActiveSquareLocation(
  locations: readonly Square.Location[],
  locationId: string,
): StoreLocation | null {
  for (const rawLocation of locations) {
    const location = mapSquareLocation(rawLocation);
    if (location?.id === locationId) return location;
  }
  return null;
}
