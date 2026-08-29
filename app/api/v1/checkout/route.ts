import { startCheckout } from "@/app/actions/checkout";
import { fail, ok } from "@/lib/api/envelope";

/**
 * Reserve the pickup slot and record the order, unpaid.
 *
 * Calls the same action the web checkout does rather than duplicating it. That
 * is safe here where it is not for most actions: `startCheckout` reaches for
 * `headers()`, which a Route Handler has, and never for `cookies()` or
 * `redirect()`, which it does not. The one cookie path — redeeming a reward —
 * is gated behind `redeemReward`, and this endpoint never sets it, so a phone
 * checks out as a guest exactly as an anonymous browser does.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  const result = await startCheckout(body);

  if (!result.ok) {
    const { failure } = result;
    if (failure.kind === "rate_limited") {
      return fail("rate_limited", "Too many attempts. Wait a few minutes and try again.");
    }
    if (failure.kind === "invalid_input") {
      /* Field errors are flattened into one sentence: the app's checkout form
         shows a single message, and inventing a per-field contract it does not
         consume would be a shape we then have to keep. */
      const first = Object.values(failure.fieldErrors).flat()[0];
      return fail("invalid_request", first ?? "Check the details and try again.");
    }
    if (failure.kind === "ordering_paused") {
      /* Two shapes carry this kind — one with the shop's own note, one
         without — so read it defensively rather than narrowing to whichever
         happens to be listed first. */
      const note = "note" in failure ? failure.note : null;
      return fail("unavailable", note ?? "The shop has paused online ordering.");
    }
    return fail("unavailable", `That order could not be placed (${failure.kind}).`);
  }

  return ok({
    orderId: result.orderId,
    orderNumber: result.orderNumber,
    subtotalCents: result.subtotalCents,
    taxCents: result.taxCents,
    totalCents: result.totalCents,
    currency: result.currency,
    holdExpiresAt: result.holdExpiresAt.toISOString(),
    reservationToken: result.reservationToken,
  });
}
