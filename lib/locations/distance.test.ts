import { describe, expect, it } from "vitest";

import { recommendPickupLocation } from "./distance";
import type { StoreLocation } from "./types";

const location = (id: string, latitude: number, longitude: number): StoreLocation => ({
  id, name: id, address: "Address", city: null, timezone: null, currency: null, phone: null, businessHours: [], coordinates: { latitude, longitude },
});

describe("recommendPickupLocation", () => {
  it("returns the geographically closest Square location", () => {
    expect(recommendPickupLocation({ latitude: 43.65, longitude: -79.38 }, [location("London", 42.98, -81.25), location("Toronto", 43.66, -79.39)])?.id).toBe("Toronto");
  });
});
