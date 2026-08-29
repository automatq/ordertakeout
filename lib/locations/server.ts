import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { isDemoMode } from "@/lib/demo/config";
import { reportError } from "@/lib/monitoring/report";
import { squareClient } from "@/lib/square/client";

import { mapSquareLocation } from "./square";
import type { LocationSnapshot, StoreLocation } from "./types";

export const LOCATIONS_TAG = "square-locations";

const DEMO_LOCATIONS: StoreLocation[] = [
  { id: "DEMO_TORONTO_WILSON", name: "Harina Bakeshoppe — Wilson", address: "314 Wilson Avenue", city: "North York, ON", timezone: "America/Toronto", currency: "CAD", country: "CA", phone: "(416) 555-0142", businessHours: demoHours(), coordinates: { latitude: 43.7305, longitude: -79.421 } },
  { id: "DEMO_TORONTO_SECOND", name: "Harina Bakeshoppe — Toronto", address: "222 Toronto Street", city: "Toronto, ON", timezone: "America/Toronto", currency: "CAD", country: "CA", phone: "(416) 555-0188", businessHours: demoHours(), coordinates: { latitude: 43.6532, longitude: -79.3832 } },
  { id: "DEMO_LONDON", name: "Harina Bakeshoppe — London", address: "125 London Road", city: "London, ON", timezone: "America/Toronto", currency: "CAD", country: "CA", phone: "(519) 555-0164", businessHours: demoHours(), coordinates: { latitude: 42.9849, longitude: -81.2453 } },
];

function demoHours() {
  return ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((dayOfWeek) => ({
    dayOfWeek,
    startTime: "08:00",
    endTime: "20:00",
  }));
}

export async function getStoreLocations(): Promise<StoreLocation[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(LOCATIONS_TAG);
  if (isDemoMode()) return DEMO_LOCATIONS;

  const response = await squareClient().locations.list();
  return (response.locations ?? []).flatMap((location) => {
    const mapped = mapSquareLocation(location);
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
    reportError("locations", "Square locations fetch failed", cause);
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
