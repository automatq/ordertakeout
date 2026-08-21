import { describe, expect, it } from "vitest";

import { checkoutLocationId } from "./checkout";

describe("checkout reservation location", () => {
  it("keeps payment initialization on the reserved location", () => {
    const reservation = { locationId: "toronto-east" };

    expect(checkoutLocationId("london", reservation)).toBe("toronto-east");
  });

  it("uses mutable storefront state only before a reservation exists", () => {
    expect(checkoutLocationId("london", null)).toBe("london");
    expect(checkoutLocationId(null, null)).toBeNull();
  });
});
