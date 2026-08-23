import type { Square } from "square";
import { describe, expect, it } from "vitest";

import { findActiveSquareLocation, mapSquareLocation } from "./square";

function squareLocation(overrides: Partial<Square.Location> = {}): Square.Location {
  return {
    id: "LOC_TORONTO",
    status: "ACTIVE",
    name: "  Harina Wilson  ",
    address: {
      addressLine1: "314 Wilson Avenue",
      addressLine2: "Unit 2",
      locality: "North York",
      administrativeDistrictLevel1: "ON",
      postalCode: "M3H 1S8",
      country: "CA",
    },
    timezone: "America/Toronto",
    currency: "CAD",
    phoneNumber: "  +14165550142  ",
    businessHours: {
      periods: [
        {
          dayOfWeek: "MON",
          startLocalTime: "08:00:00",
          endLocalTime: "20:00:00",
        },
        { dayOfWeek: "TUE", startLocalTime: "09:00:00" },
      ],
    },
    coordinates: { latitude: 43.7305, longitude: -79.421 },
    ...overrides,
  } as Square.Location;
}

describe("mapSquareLocation", () => {
  it("normalizes an active Square location for storefront and CLI use", () => {
    expect(mapSquareLocation(squareLocation())).toEqual({
      id: "LOC_TORONTO",
      name: "Harina Wilson",
      address: "314 Wilson Avenue, Unit 2",
      city: "North York, ON, M3H 1S8",
      timezone: "America/Toronto",
      currency: "CAD",
      country: "CA",
      phone: "+14165550142",
      businessHours: [{ dayOfWeek: "MON", startTime: "08:00", endTime: "20:00" }],
      coordinates: { latitude: 43.7305, longitude: -79.421 },
    });
  });

  it("rejects inactive and identifier-less Square locations", () => {
    expect(mapSquareLocation(squareLocation({ status: "INACTIVE" }))).toBeNull();
    expect(mapSquareLocation(squareLocation({ id: undefined }))).toBeNull();
  });

  it("validates an id against Square's active location list", () => {
    const locations = [
      squareLocation({ id: "INACTIVE", status: "INACTIVE" }),
      squareLocation({ id: "ACTIVE" }),
    ];

    expect(findActiveSquareLocation(locations, "ACTIVE")?.id).toBe("ACTIVE");
    expect(findActiveSquareLocation(locations, "INACTIVE")).toBeNull();
    expect(findActiveSquareLocation(locations, "UNKNOWN")).toBeNull();
  });

  it("uses customer-safe fallbacks for sparse active locations", () => {
    expect(
      mapSquareLocation(
        squareLocation({
          name: " ",
          address: undefined,
          phoneNumber: undefined,
          businessHours: undefined,
          coordinates: undefined,
        }),
      ),
    ).toMatchObject({
      name: "Pickup location",
      address: "Address available at checkout",
      city: null,
      country: null,
      phone: null,
      businessHours: [],
      coordinates: null,
    });
  });
});
