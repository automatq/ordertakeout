import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { serverEnv } from "@/lib/env";

import { isOrderNumber, normalizeOrderNumber } from "./number";

const PICKUP_PASS_PREFIX = "harina-pickup:v1";

function secret(): string {
  return serverEnv().ORDER_ACCESS_SECRET ?? serverEnv().STAFF_DASHBOARD_PASSWORD;
}

function signature(orderId: string, orderNumber: string): string {
  return createHmac("sha256", secret())
    .update(`pickup:${orderId}:${orderNumber}`)
    .digest("base64url");
}

/** Opaque payload for the QR code a customer presents at collection. */
export function createPickupPass(orderId: string, orderNumber: string): string {
  return `${PICKUP_PASS_PREFIX}:${orderNumber}:${signature(orderId, orderNumber)}`;
}

export type ParsedPickupPass = { orderNumber: string; token: string };

export function parsePickupPass(value: string): ParsedPickupPass | null {
  const parts = value.trim().split(":");
  if (parts.length !== 4 || `${parts[0]}:${parts[1]}` !== PICKUP_PASS_PREFIX) return null;

  const orderNumber = normalizeOrderNumber(parts[2] ?? "");
  const token = parts[3] ?? "";
  if (!isOrderNumber(orderNumber) || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return null;
  }
  return { orderNumber, token };
}

export function verifyPickupPass(orderId: string, orderNumber: string, token: string): boolean {
  const expected = Buffer.from(signature(orderId, orderNumber));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
