import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { serverEnv } from "@/lib/env";

function secret(): string {
  return serverEnv().ORDER_ACCESS_SECRET ?? serverEnv().STAFF_DASHBOARD_PASSWORD;
}

export function createOrderAccessToken(orderId: string, orderNumber: string): string {
  return createHmac("sha256", secret())
    .update(`${orderId}:${orderNumber}`)
    .digest("base64url");
}

export function verifyOrderAccessToken(
  orderId: string,
  orderNumber: string,
  token: string | undefined,
): boolean {
  if (!token) return false;
  const expected = Buffer.from(createOrderAccessToken(orderId, orderNumber));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function orderTrackingUrl(orderId: string, orderNumber: string): string | null {
  const origin = serverEnv().STORE_PUBLIC_URL;
  if (!origin) return null;
  const url = new URL(`/orders/${encodeURIComponent(orderNumber)}`, origin);
  url.searchParams.set("key", createOrderAccessToken(orderId, orderNumber));
  return url.toString();
}

