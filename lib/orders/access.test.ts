import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ORDER_SHORT_TOKEN_LENGTH,
  createOrderAccessToken,
  createOrderShortToken,
  orderShortCode,
  orderShortUrl,
  orderTrackingUrl,
  parseOrderShortCode,
  verifyOrderShortToken,
} from "./access";

const mocks = vi.hoisted(() => ({ publicUrl: "https://harinabakeshoppe.com" as string | undefined }));

vi.mock("@/lib/env", () => ({
  serverEnv: () => ({
    ORDER_ACCESS_SECRET: "test-order-access-secret",
    STAFF_DASHBOARD_PASSWORD: "unused",
    STORE_PUBLIC_URL: mocks.publicUrl,
  }),
}));

const ORDER_ID = "6f1b2c3d-0000-4000-8000-000000000001";
const ORDER_NUMBER = "PT-K7M2QX9D";

beforeEach(() => {
  mocks.publicUrl = "https://harinabakeshoppe.com";
});

describe("order short links", () => {
  it("fits a tracking link into one SMS segment alongside a real message", () => {
    // The whole reason this exists: the long form is ~95 chars against a
    // 160-char segment, which left no room for the message.
    const short = orderShortUrl(ORDER_ID, ORDER_NUMBER)!;
    const long = orderTrackingUrl(ORDER_ID, ORDER_NUMBER)!;

    expect(short.length).toBeLessThan(50);
    expect(long.length).toBeGreaterThan(90);
    expect(short).toBe(`https://harinabakeshoppe.com/o/K7M2QX9D${createOrderShortToken(ORDER_ID, ORDER_NUMBER)}`);
  });

  it("round-trips the order number and token", () => {
    const parsed = parseOrderShortCode(orderShortCode(ORDER_ID, ORDER_NUMBER));
    expect(parsed).not.toBeNull();
    expect(parsed!.orderNumber).toBe(ORDER_NUMBER);
    expect(verifyOrderShortToken(ORDER_ID, parsed!.orderNumber, parsed!.token)).toBe(true);
  });

  it("round-trips legacy six-character order numbers", () => {
    // The token is a fixed-width suffix precisely so both code lengths parse.
    const legacy = "PT-K7M2QX";
    const parsed = parseOrderShortCode(orderShortCode(ORDER_ID, legacy));
    expect(parsed!.orderNumber).toBe(legacy);
    expect(verifyOrderShortToken(ORDER_ID, legacy, parsed!.token)).toBe(true);
  });

  it("rejects a token belonging to a different order", () => {
    const other = createOrderShortToken("00000000-0000-4000-8000-000000000002", ORDER_NUMBER);
    expect(verifyOrderShortToken(ORDER_ID, ORDER_NUMBER, other)).toBe(false);
    expect(verifyOrderShortToken(ORDER_ID, ORDER_NUMBER, undefined)).toBe(false);
    expect(verifyOrderShortToken(ORDER_ID, ORDER_NUMBER, "")).toBe(false);
  });

  it("rejects a truncated or padded token without throwing", () => {
    const token = createOrderShortToken(ORDER_ID, ORDER_NUMBER);
    expect(verifyOrderShortToken(ORDER_ID, ORDER_NUMBER, token.slice(0, 4))).toBe(false);
    expect(verifyOrderShortToken(ORDER_ID, ORDER_NUMBER, `${token}xx`)).toBe(false);
  });

  it("is cryptographically independent of the long tracking token", () => {
    // A leaked short code must not reveal a prefix of the full access token.
    const short = createOrderShortToken(ORDER_ID, ORDER_NUMBER);
    const long = createOrderAccessToken(ORDER_ID, ORDER_NUMBER);
    expect(short).toHaveLength(ORDER_SHORT_TOKEN_LENGTH);
    expect(long.startsWith(short)).toBe(false);
  });

  it("refuses codes too short to carry a token", () => {
    expect(parseOrderShortCode("abc")).toBeNull();
    expect(parseOrderShortCode("")).toBeNull();
    expect(parseOrderShortCode("x".repeat(ORDER_SHORT_TOKEN_LENGTH))).toBeNull();
  });

  it("normalises the order-code half but leaves the token byte-exact", () => {
    // Order numbers are a case-insensitive alphabet, so the code half is
    // upper-cased. The token half is base64url and case-SENSITIVE: lowering it
    // would collapse its entropy, so a fully lower-cased link is expected to
    // fail verification rather than be silently accepted.
    const code = orderShortCode(ORDER_ID, ORDER_NUMBER);
    const lowered = parseOrderShortCode(code.toLowerCase())!;
    expect(lowered.orderNumber).toBe(ORDER_NUMBER);
    expect(verifyOrderShortToken(ORDER_ID, lowered.orderNumber, lowered.token)).toBe(false);

    const exact = parseOrderShortCode(code)!;
    expect(verifyOrderShortToken(ORDER_ID, exact.orderNumber, exact.token)).toBe(true);
  });

  it("yields no link when no public URL is configured", () => {
    mocks.publicUrl = undefined;
    expect(orderShortUrl(ORDER_ID, ORDER_NUMBER)).toBeNull();
    expect(orderTrackingUrl(ORDER_ID, ORDER_NUMBER)).toBeNull();
  });
});
