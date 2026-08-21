import { afterEach, describe, expect, it } from "vitest";

import {
  acquirePickupLocationLock,
  isPickupLocationChangeAllowed,
  releasePickupLocationLock,
} from "./store";

describe("pickup location checkout lock", () => {
  afterEach(() => {
    releasePickupLocationLock("toronto-east");
    releasePickupLocationLock("london");
  });

  it("prevents a different location while a checkout reservation is active", () => {
    expect(acquirePickupLocationLock("toronto-east")).toBe(true);

    expect(isPickupLocationChangeAllowed("toronto-east")).toBe(true);
    expect(isPickupLocationChangeAllowed("london")).toBe(false);
    expect(isPickupLocationChangeAllowed(null)).toBe(false);
    expect(acquirePickupLocationLock("london")).toBe(false);
  });

  it("only lets the reservation owner release its location lock", () => {
    acquirePickupLocationLock("toronto-east");

    releasePickupLocationLock("london");
    expect(isPickupLocationChangeAllowed("london")).toBe(false);

    releasePickupLocationLock("toronto-east");
    expect(isPickupLocationChangeAllowed("london")).toBe(true);
  });
});
