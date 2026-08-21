/** The minimum reservation shape needed to bind checkout to a pickup shop. */
export interface LocationBoundReservation {
  locationId: string;
}

/**
 * Once a slot is reserved, every payment-facing view must use the reservation's
 * server-validated location rather than mutable storefront state.
 */
export function checkoutLocationId(
  selectedLocationId: string | null,
  reservation: LocationBoundReservation | null,
): string | null {
  return reservation?.locationId ?? selectedLocationId;
}
