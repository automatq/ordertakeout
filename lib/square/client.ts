import "server-only";

import { SquareClient, SquareEnvironment } from "square";

import { publicEnv, serverEnv } from "@/lib/env";

let cached: SquareClient | undefined;

/**
 * Server-side Square client (Catalog, Orders, Payments, Refunds).
 *
 * Note this is the v40+ SDK, which was a full rewrite: the client is constructed
 * with `{ token }` rather than `{ accessToken }`, calls are namespaced
 * (`client.orders.create(...)`), and **money amounts are `bigint`, not `number`**.
 * Older Square examples found online will not compile against this.
 */
export function squareClient(): SquareClient {
  if (!cached) {
    cached = new SquareClient({
      token: serverEnv().SQUARE_ACCESS_TOKEN,
      environment:
        publicEnv().NEXT_PUBLIC_SQUARE_ENVIRONMENT === "production"
          ? SquareEnvironment.Production
          : SquareEnvironment.Sandbox,
    });
  }
  return cached;
}

export const squareLocationId = () => publicEnv().NEXT_PUBLIC_SQUARE_LOCATION_ID;

/**
 * Square money amounts are in the smallest currency unit (cents for USD) and are
 * `bigint` in this SDK. We store cents as `integer` in Postgres, so every
 * boundary crossing goes through these two helpers rather than ad-hoc casts.
 */
export const toSquareAmount = (cents: number): bigint => BigInt(cents);

export const fromSquareAmount = (amount: bigint | null | undefined): number =>
  amount == null ? 0 : Number(amount);
