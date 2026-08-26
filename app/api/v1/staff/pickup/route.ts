import { z } from "zod";

import { staffDeviceFromRequest } from "@/lib/api/context";
import { toPickupPreview } from "@/lib/api/dto";
import { fail, ok, unauthorized } from "@/lib/api/envelope";
import {
  previewPickupVerification,
  verifyPickup,
} from "@/lib/orders/pickup-verification";

/**
 * Pickup verification for the staff app.
 *
 * Two steps in one route, because they are two halves of one action at the
 * counter: scan the customer's pass, read their name back to them, then hand the
 * order over. Splitting them across routes would invite a client that verifies
 * without ever showing anyone the name — which is the whole check.
 *
 * The scanner sends the pass string exactly as it came off the QR code; parsing
 * and signature checking stay server-side in lib/orders/pickup-verification.ts,
 * so a patched app cannot talk its way past them.
 */

const previewSchema = z.object({
  intent: z.literal("preview"),
  method: z.enum(["qr", "manual"]),
  value: z.string().trim().min(1).max(500),
});

const confirmSchema = z.object({
  intent: z.literal("confirm"),
  method: z.enum(["qr", "manual"]),
  value: z.string().trim().min(1).max(500),
  /* Attribution while staff share one sign-in. Whoever handed the order over
     types their initials, and that is what lands in the audit trail. */
  staffInitials: z.string().trim().min(1).max(12),
});

const bodySchema = z.discriminatedUnion("intent", [previewSchema, confirmSchema]);

export async function POST(request: Request): Promise<Response> {
  if (!(await staffDeviceFromRequest(request))) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Scan a pickup pass or enter an order number.");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return fail("invalid_request", "Scan a pickup pass or enter an order number.");
  }

  if (parsed.data.intent === "preview") {
    const preview = await previewPickupVerification(parsed.data);
    /* A refusal is a 200 with ok:false, not a 4xx. The reason is meant for the
       person at the counter — "this order was cancelled" — and it is not an
       error in the request, which is what a 400 would claim. */
    if ("ok" in preview) return ok({ found: false, reason: preview.reason });
    return ok({ found: true, order: toPickupPreview(preview) });
  }

  const result = await verifyPickup(parsed.data);
  if (!result.ok) return ok({ verified: false, reason: result.reason });

  return ok({
    verified: true,
    orderId: result.orderId,
    orderNumber: result.orderNumber,
    ...(result.squareWarning ? { squareWarning: result.squareWarning } : {}),
  });
}
