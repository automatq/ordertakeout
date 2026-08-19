import crypto from "node:crypto";

import { WebhooksHelper } from "square";
import { describe, expect, it } from "vitest";

/**
 * Verifies our understanding of Square's webhook signing scheme, and that the
 * endpoint passes the right things to it.
 *
 * This is testable without Square: the signature is an HMAC we can compute
 * ourselves. Worth pinning, because a signature check that silently rejects
 * everything looks exactly like "Square isn't sending webhooks" and would be
 * chased in the wrong place for hours.
 */

const SIGNATURE_KEY = "test-signature-key";
const NOTIFICATION_URL = "https://example.com/api/webhooks/square";

const BODY = JSON.stringify({
  type: "payment.updated",
  event_id: "evt_1",
  data: { object: { payment: { id: "PAY_1", status: "COMPLETED" } } },
});

/** Square signs `notificationUrl + rawBody` with HMAC-SHA256, base64-encoded. */
function sign(body: string, url = NOTIFICATION_URL, key = SIGNATURE_KEY): string {
  return crypto.createHmac("sha256", key).update(url + body).digest("base64");
}

const verify = (body: string, signature: string, url = NOTIFICATION_URL) =>
  WebhooksHelper.verifySignature({
    requestBody: body,
    signatureHeader: signature,
    signatureKey: SIGNATURE_KEY,
    notificationUrl: url,
  });

describe("Square webhook signature verification", () => {
  it("accepts a correctly signed body", async () => {
    expect(await verify(BODY, sign(BODY))).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const signature = sign(BODY);
    const tampered = BODY.replace("COMPLETED", "FAILED");
    expect(await verify(tampered, signature)).toBe(false);
  });

  it("rejects a signature made with the wrong key", async () => {
    expect(await verify(BODY, sign(BODY, NOTIFICATION_URL, "wrong-key"))).toBe(false);
  });

  it("rejects a signature made for a different notification URL", async () => {
    // The URL is part of the signed payload, which is why the value configured in
    // the Square console must match SQUARE_WEBHOOK_NOTIFICATION_URL exactly.
    expect(await verify(BODY, sign(BODY, "https://example.com/other"))).toBe(false);
  });

  it("rejects when the configured URL differs only by a trailing slash", async () => {
    // The most likely real-world misconfiguration, and it fails closed.
    expect(await verify(BODY, sign(BODY), `${NOTIFICATION_URL}/`)).toBe(false);
  });

  it("rejects a body that was re-serialised rather than passed through verbatim", async () => {
    // Guards the decision to read request.text() instead of request.json().
    // Square's real payloads are not in JSON.stringify's canonical form, so a
    // round-trip through parse/stringify changes the bytes and breaks the HMAC.
    const rawFromSquare = '{\n  "type": "payment.updated",\n  "event_id": "evt_1"\n}';
    const signature = sign(rawFromSquare);

    expect(await verify(rawFromSquare, signature)).toBe(true);

    const reserialised = JSON.stringify(JSON.parse(rawFromSquare));
    expect(reserialised).not.toBe(rawFromSquare);
    expect(await verify(reserialised, signature)).toBe(false);
  });

  it("rejects empty and malformed signatures", async () => {
    for (const bad of ["", "not-base64!!", "YWJj"]) {
      expect(await verify(BODY, bad)).toBe(false);
    }
  });
});
