import { WebhooksHelper } from "square";

import { serverEnv } from "@/lib/env";
import {
  applySquareEvent,
  claimEvent,
  markEventProcessed,
  recordEventError,
} from "@/lib/webhooks/apply";
import { parseSquareEvent } from "@/lib/webhooks/events";

/**
 * Square webhook endpoint.
 *
 * Subscribe to `payment.updated`, `refund.created`, `refund.updated`, and
 * `order.fulfillment.updated` in the Square Developer Console, pointed at this
 * URL. The subscription URL must match
 * `SQUARE_WEBHOOK_NOTIFICATION_URL` character for character — it is part of the
 * signed payload, so even a trailing-slash difference fails verification.
 *
 * Route Handlers are not cached for POST, so no cache opt-out is needed here.
 */

export async function POST(request: Request): Promise<Response> {
  const env = serverEnv();

  // The raw text, not request.json(). The signature is computed over the exact
  // bytes Square sent; re-serialising parsed JSON would change them and every
  // signature would fail.
  const rawBody = await request.text();
  const signature = request.headers.get("x-square-hmacsha256-signature");

  if (!signature) {
    return new Response("Missing signature", { status: 401 });
  }

  const valid = await WebhooksHelper.verifySignature({
    requestBody: rawBody,
    signatureHeader: signature,
    signatureKey: env.SQUARE_WEBHOOK_SIGNATURE_KEY,
    notificationUrl: env.SQUARE_WEBHOOK_NOTIFICATION_URL,
  });

  if (!valid) {
    console.warn("[webhooks] rejected an event with an invalid signature");
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Signed but unparseable: retrying will not help.
    return new Response("Malformed JSON", { status: 400 });
  }

  const parsed = parseSquareEvent(payload);
  if (!parsed.ok) {
    console.warn("[webhooks] unrecognised payload:", parsed.reason);
    // 200 on purpose — Square would otherwise retry a payload we will never
    // understand, forever.
    return Response.json({ ignored: true, reason: parsed.reason });
  }

  const event = parsed.event;

  // Recording the event is itself a database write and can fail — if it throws
  // uncaught the caller gets a bare 500 with no log line explaining it, which is
  // a miserable thing to debug at 6am. Square retries on 5xx, which is the right
  // outcome here since an unreachable database is transient.
  let claim: Awaited<ReturnType<typeof claimEvent>>;
  try {
    claim = await claimEvent(event.eventId, event.type, payload);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[webhooks] could not record ${event.type} (${event.eventId}):`, message);
    return new Response("Could not record event", { status: 503 });
  }

  if (claim.status === "processed") {
    return Response.json({ duplicate: true, eventId: event.eventId });
  }
  if (claim.status === "busy") {
    // Do not acknowledge a still-running duplicate as complete: if the active
    // worker fails, Square must retry instead of considering the event handled.
    return new Response("Event is already processing", { status: 503 });
  }

  try {
    const outcome = await applySquareEvent(event);
    if (outcome.retryable) {
      await recordEventError(event.eventId, outcome.detail);
      console.warn(`[webhooks] deferred ${event.type}: ${outcome.detail}`);
      return new Response("Event is waiting for local reconciliation", { status: 503 });
    }
    await markEventProcessed(event.eventId);
    console.info(`[webhooks] ${event.type}: ${outcome.detail}`);
    return Response.json({ handled: outcome.handled, detail: outcome.detail });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[webhooks] failed to apply ${event.type}:`, message);

    // Records the error but leaves `processed_at` null, so the event stays
    // eligible for reprocessing. 500 asks Square to retry it.
    await recordEventError(event.eventId, message).catch(() => {});
    return new Response("Processing failed", { status: 500 });
  }
}
