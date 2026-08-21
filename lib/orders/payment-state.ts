import { randomUUID } from "node:crypto";

/** Temporary marker stored while one browser owns the Square payment attempt. */
export const PAYMENT_ATTEMPT_PREFIX = "PROCESSING:";
export const PAYMENT_ATTEMPT_LEASE_MS = 2 * 60_000;
/** Longer than the ten-minute checkout hold and every bounded Square request. */
export const PAYMENT_ATTEMPT_RECOVERY_AFTER_MS = 15 * 60_000;

/**
 * Payment-bound reservations must outlive every external Square request and an
 * ambiguous response. A far-future timestamp keeps the existing availability
 * queries authoritative without holding a database transaction across the
 * network. Terminal success, a definitive failure, cancellation, or a Square
 * webhook always deletes or restores these rows.
 */
export const PAYMENT_RESERVATION_PROTECTED_UNTIL_ISO = "9999-12-31T23:59:59.999Z";

export function paymentReservationProtectedUntil(): Date {
  return new Date(PAYMENT_RESERVATION_PROTECTED_UNTIL_ISO);
}

export function isPaymentReservationProtected(expiresAt: Date): boolean {
  return expiresAt.getUTCFullYear() === 9999;
}

/** Square accepts keys up to 45 characters; these are 44 and 43 respectively. */
export function createPaymentAttemptKey(id = randomUUID()): string {
  return `payment-${id}`;
}

export function createRefundAttemptKey(id = randomUUID()): string {
  return `refund-${id}`;
}

export function paymentAttemptMarker(orderId: string): string {
  return `${PAYMENT_ATTEMPT_PREFIX}${orderId}`;
}

export function isPaymentAttemptMarker(value: string | null): boolean {
  return value?.startsWith(PAYMENT_ATTEMPT_PREFIX) ?? false;
}

export function isAttemptLeaseStale(
  startedAt: Date | null,
  now: Date = new Date(),
  leaseMs = PAYMENT_ATTEMPT_LEASE_MS,
): boolean {
  return startedAt !== null && startedAt.getTime() < now.getTime() - leaseMs;
}
