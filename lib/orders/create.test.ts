import { describe, expect, it } from "vitest";

import { isOrderNumberUniqueViolation } from "./create";

describe("isOrderNumberUniqueViolation", () => {
  it("identifies only the order-number unique index conflict", () => {
    expect(isOrderNumberUniqueViolation({ code: "23505", constraint: "orders_order_number_key" })).toBe(true);
    expect(isOrderNumberUniqueViolation({ code: "23505", constraint: "orders_square_order_id_key" })).toBe(false);
    expect(isOrderNumberUniqueViolation({ code: "23503", constraint: "orders_order_number_key" })).toBe(false);
    expect(isOrderNumberUniqueViolation(null)).toBe(false);
  });
});
