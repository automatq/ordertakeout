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


/* -------------------------------------------------------------------------- */
/* Short links (SMS)                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A full tracking URL is ~95 characters — the 43-char access token alone eats
 * most of a 160-character SMS segment, which is why the link used to be
 * dropped from every text. The short form encodes the same guarantee in 16:
 * the order's own code followed by a truncated, separately-labelled HMAC.
 *
 * Eight base64url characters is 48 bits. An attacker must already know a valid
 * order code (853 billion of those) and then guess 281 trillion tokens for one
 * order's pickup details — far past the point where anything else is the weak
 * link.
 */
export const ORDER_SHORT_TOKEN_LENGTH = 8;

/**
 * Labelled separately from the tracking token so the two are cryptographically
 * independent: a leaked short code reveals nothing about the long one, even
 * though both derive from the same secret.
 */
export function createOrderShortToken(orderId: string, orderNumber: string): string {
  return createHmac("sha256", secret())
    .update(`short:${orderId}:${orderNumber}`)
    .digest("base64url")
    .slice(0, ORDER_SHORT_TOKEN_LENGTH);
}

export function verifyOrderShortToken(
  orderId: string,
  orderNumber: string,
  token: string | undefined,
): boolean {
  if (!token) return false;
  const expected = Buffer.from(createOrderShortToken(orderId, orderNumber));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * `PT-K7M2QX9D` + token becomes `K7M2QX9Dab3XyZ_1`.
 *
 * The token is a fixed-width suffix rather than a delimited field because
 * base64url already uses `-` and `_`; splitting on a separator would collide
 * with the token's own alphabet. Taking it from the end also keeps both the
 * current 8-character order codes and the legacy 6-character ones parseable.
 */
export function orderShortCode(orderId: string, orderNumber: string): string {
  return `${orderNumber.replace(/^PT-/, "")}${createOrderShortToken(orderId, orderNumber)}`;
}

export function parseOrderShortCode(
  code: string,
): { orderNumber: string; token: string } | null {
  const trimmed = code.trim();
  if (trimmed.length <= ORDER_SHORT_TOKEN_LENGTH) return null;
  return {
    orderNumber: `PT-${trimmed.slice(0, -ORDER_SHORT_TOKEN_LENGTH).toUpperCase()}`,
    token: trimmed.slice(-ORDER_SHORT_TOKEN_LENGTH),
  };
}

/** SMS-sized tracking link. Null when STORE_PUBLIC_URL is unset, like the long form. */
export function orderShortUrl(orderId: string, orderNumber: string): string | null {
  const origin = serverEnv().STORE_PUBLIC_URL;
  if (!origin) return null;
  return new URL(`/o/${orderShortCode(orderId, orderNumber)}`, origin).toString();
}
