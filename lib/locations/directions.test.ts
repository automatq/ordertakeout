import { describe, expect, it } from "vitest";

import { pickupLocationDirections } from "./directions";
import type { StoreLocation } from "./types";

const location = (overrides: Partial<StoreLocation> = {}): StoreLocation => ({
  id: "LOCATION_1",
  name: "Harina Bakeshoppe — Toronto",
  address: "222 Toronto Street",
  city: "Toronto, ON",
  timezone: "America/Toronto",
  currency: "CAD",
  country: "CA",
  phone: null,
  businessHours: [],
  coordinates: { latitude: 43.6532, longitude: -79.3832 },
  ...overrides,
});

describe("pickupLocationDirections", () => {
  it("uses Square coordinates as an unambiguous map destination", () => {
    const links = pickupLocationDirections(location());

    expect(new URL(links.googleMaps).searchParams.get("api")).toBe("1");
    expect(new URL(links.googleMaps).searchParams.get("destination")).toBe("43.6532,-79.3832");
    expect(new URL(links.waze).searchParams.get("q")).toBe("43.6532,-79.3832");
    expect(new URL(links.waze).searchParams.get("navigate")).toBe("yes");
    expect(new URL(links.appleMaps).searchParams.get("daddr")).toBe("43.6532,-79.3832");
    expect(new URL(links.appleMaps).searchParams.get("dirflg")).toBe("d");
  });

  it("falls back to the complete address when coordinates are unavailable", () => {
    const links = pickupLocationDirections(location({
      coordinates: null,
      address: "314 Wilson Avenue",
      city: "North York, ON M3S 1S8",
    }));

    expect(new URL(links.googleMaps).searchParams.get("destination"))
      .toBe("314 Wilson Avenue, North York, ON M3S 1S8");
    expect(new URL(links.waze).searchParams.get("q"))
      .toBe("314 Wilson Avenue, North York, ON M3S 1S8");
    expect(new URL(links.appleMaps).searchParams.get("daddr"))
      .toBe("314 Wilson Avenue, North York, ON M3S 1S8");
  });
});
