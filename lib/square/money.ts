/**
 * Money conversion at the Square boundary.
 *
 * Kept separate from lib/square/client.ts (which is `server-only`) so pure
 * mapping code and its tests can use it without pulling in the SDK client.
 *
 * Square represents money as the smallest currency unit — cents for USD — and
 * the v40+ SDK types it as `bigint`. We store cents as `integer` in Postgres.
 * Every crossing goes through these helpers rather than ad-hoc casts.
 */

export const toSquareAmount = (cents: number): bigint => BigInt(cents);

export function fromSquareAmount(amount: bigint | null | undefined): number {
  if (amount == null) return 0;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER) || amount < BigInt(-Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Square money amount ${amount} exceeds safe integer range`);
  }
  return Number(amount);
}

/** Format cents for display, e.g. 2500 → "$25.00". */
export function formatMoney(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
