import { describe, expect, it } from "vitest";

import {
  createPaymentAttemptKey,
  createRefundAttemptKey,
  isAttemptLeaseStale,
  isPaymentAttemptMarker,
  isPaymentReservationProtected,
  PAYMENT_ATTEMPT_LEASE_MS,
  PAYMENT_ATTEMPT_RECOVERY_AFTER_MS,
  paymentAttemptMarker,
  paymentReservationProtectedUntil,
} from "./payment-state";

describe("payment attempt markers", () => {
  it("distinguishes temporary payment ownership from a Square payment id", () => {
    expect(paymentAttemptMarker("order-1")).toBe("PROCESSING:order-1");
    expect(isPaymentAttemptMarker("PROCESSING:order-1")).toBe(true);
    expect(isPaymentAttemptMarker("SQ_PAYMENT_1")).toBe(false);
    expect(isPaymentAttemptMarker(null)).toBe(false);
  });

  it("creates bounded Square idempotency keys for each attempt kind", () => {
    const id = "00000000-0000-4000-8000-000000000000";

    expect(createPaymentAttemptKey(id)).toBe(`payment-${id}`);
    expect(createRefundAttemptKey(id)).toBe(`refund-${id}`);
    expect(createPaymentAttemptKey(id)).toHaveLength(44);
    expect(createRefundAttemptKey(id)).toHaveLength(43);
  });

  it("classifies attempt ownership using the persisted start time", () => {
    const now = new Date("2026-08-20T18:00:00.000Z");

    expect(isAttemptLeaseStale(new Date("2026-08-20T17:57:59.999Z"), now)).toBe(true);
    expect(isAttemptLeaseStale(new Date("2026-08-20T17:58:00.000Z"), now)).toBe(false);
    expect(isAttemptLeaseStale(null, now)).toBe(false);
  });

  it("waits beyond the live attempt lease before maintenance recovery", () => {
    expect(PAYMENT_ATTEMPT_RECOVERY_AFTER_MS).toBeGreaterThan(PAYMENT_ATTEMPT_LEASE_MS);
    expect(PAYMENT_ATTEMPT_RECOVERY_AFTER_MS).toBeGreaterThanOrEqual(15 * 60_000);
  });

  it("uses a recognizable non-expiring deadline for payment-bound holds", () => {
    const protectedUntil = paymentReservationProtectedUntil();

    expect(protectedUntil.toISOString()).toBe("9999-12-31T23:59:59.999Z");
    expect(isPaymentReservationProtected(protectedUntil)).toBe(true);
    expect(isPaymentReservationProtected(new Date("2026-08-20T18:10:00.000Z"))).toBe(false);
  });
});
