import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import type { Square } from "square";

import { isDemoMode } from "@/lib/demo/config";
import { squareClient } from "@/lib/square/client";

import type { LocationSnapshot, StoreLocation } from "./types";

export const LOCATIONS_TAG = "square-locations";

const DEMO_LOCATIONS: StoreLocation[] = [
  { id: "DEMO_TORONTO_WILSON", name: "Harina Bakeshoppe — Wilson", address: "314 Wilson Avenue", city: "North York, ON", timezone: "America/Toronto", currency: "CAD", phone: "(416) 555-0142", businessHours: demoHours(), coordinates: { latitude: 43.7305, longitude: -79.421 } },
  { id: "DEMO_TORONTO_SECOND", name: "Harina Bakeshoppe — Toronto", address: "222 Toronto Street", city: "Toronto, ON", timezone: "America/Toronto", currency: "CAD", phone: "(416) 555-0188", businessHours: demoHours(), coordinates: { latitude: 43.6532, longitude: -79.3832 } },
  { id: "DEMO_LONDON", name: "Harina Bakeshoppe — London", address: "125 London Road", city: "London, ON", timezone: "America/Toronto", currency: "CAD", phone: "(519) 555-0164", businessHours: demoHours(), coordinates: { latitude: 42.9849, longitude: -81.2453 } },
];

function demoHours() {
  return ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((dayOfWeek) => ({
    dayOfWeek,
    startTime: "08:00",
    endTime: "20:00",
  }));
}

function mapLocation(location: Square.Location): StoreLocation | null {
  if (!location.id || location.status !== "ACTIVE") return null;
  const address = location.address;
  const addressLine = [address?.addressLine1, address?.addressLine2].filter(Boolean).join(", ");
  return {
    id: location.id,
    name: location.name?.trim() || "Pickup location",
    address: addressLine || "Address available at checkout",
    city: [address?.locality, address?.administrativeDistrictLevel1, address?.postalCode]
      .filter(Boolean)
      .join(", ") || null,
    timezone: location.timezone ?? null,
    currency: location.currency ?? null,
    phone: location.phoneNumber?.trim() || null,
    businessHours: (location.businessHours?.periods ?? []).flatMap((period) =>
      period.dayOfWeek && period.startLocalTime && period.endLocalTime
        ? [{
            dayOfWeek: period.dayOfWeek,
            startTime: period.startLocalTime.slice(0, 5),
            endTime: period.endLocalTime.slice(0, 5),
          }]
        : [],
    ),
    coordinates: location.coordinates?.latitude != null && location.coordinates.longitude != null
      ? { latitude: location.coordinates.latitude, longitude: location.coordinates.longitude }
      : null,
  };
}

export async function getStoreLocations(): Promise<StoreLocation[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(LOCATIONS_TAG);
  if (isDemoMode()) return DEMO_LOCATIONS;

  const response = await squareClient().locations.list();
  return (response.locations ?? []).flatMap((location) => {
    const mapped = mapLocation(location);
    return mapped ? [mapped] : [];
  });
}

export async function getStoreLocation(id: string): Promise<StoreLocation | null> {
  return (await getStoreLocations()).find((location) => location.id === id) ?? null;
}

/** Read-only staff views stay usable during a Square locations outage. */
export async function getStoreLocationsSafe(): Promise<StoreLocation[]> {
  try {
    return await getStoreLocations();
  } catch (cause) {
    console.error("[locations] Square locations fetch failed:", cause instanceof Error ? cause.message : cause);
    return [];
  }
}

export function snapshotLocation(location: StoreLocation): LocationSnapshot {
  return {
    id: location.id,
    name: location.name,
    address: location.address,
    city: location.city,
    phone: location.phone,
    timezone: location.timezone,
    businessHours: location.businessHours,
  };
}
