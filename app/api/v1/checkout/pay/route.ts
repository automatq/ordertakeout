import { completeCheckout } from "@/app/actions/checkout";
import { fail, ok } from "@/lib/api/envelope";

/**
 * Charge the reserved order.
 *
 * In demo mode the payment is simulated server-side and any source id is
 * accepted, which is what lets the whole path be walked without a Square
 * account. A source ending in "decline" is refused, so the failure branch can
 * be demonstrated too and not just the happy one.
 *
 * The access token in the response is what opens the order afterwards — the
 * app stores it with the order number and uses it for tracking and the pass.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  const result = await completeCheckout(body);

  if (!result.ok) {
    return fail(result.code === "RATE_LIMITED" ? "rate_limited" : "invalid_request", result.message);
  }
  return ok({ orderNumber: result.orderNumber, accessToken: result.accessToken });
}
