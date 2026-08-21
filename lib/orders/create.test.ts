import { describe, expect, it } from "vitest";

import { isOrderNumberUniqueViolation, shouldReleasePaymentClaim } from "./create";

describe("isOrderNumberUniqueViolation", () => {
  it("identifies only the order-number unique index conflict", () => {
    expect(isOrderNumberUniqueViolation({ code: "23505", constraint: "orders_order_number_key" })).toBe(true);
    expect(isOrderNumberUniqueViolation({ code: "23505", constraint: "orders_square_order_id_key" })).toBe(false);
    expect(isOrderNumberUniqueViolation({ code: "23503", constraint: "orders_order_number_key" })).toBe(false);
    expect(isOrderNumberUniqueViolation(null)).toBe(false);
  });
});

describe("shouldReleasePaymentClaim", () => {
  it("keeps ambiguous and asynchronous attempts locked for idempotent retry", () => {
    for (const code of [
      "SQUARE_ERROR",
      "NO_PAYMENT",
      "PAYMENT_APPROVED",
      "PAYMENT_PENDING",
      "PAYMENT_UNKNOWN",
    ]) {
      expect(shouldReleasePaymentClaim(code)).toBe(false);
    }
  });

  it("releases definitive declines so the customer can correct payment details", () => {
    expect(shouldReleasePaymentClaim("CARD_DECLINED")).toBe(true);
    expect(shouldReleasePaymentClaim("CVV_FAILURE")).toBe(true);
    expect(shouldReleasePaymentClaim("PAYMENT_FAILED")).toBe(true);
  });
});
