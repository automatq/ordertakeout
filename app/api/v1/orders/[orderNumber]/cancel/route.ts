import { fingerprintFromRequest } from "@/lib/api/context";
import { fail, ok } from "@/lib/api/envelope";
import { cancelOrderWithToken } from "@/lib/api/order-cancel";

/**
 * Cancelling your own order from the app.
 *
 * Authorised by the same signed key that reads the order — there is no account
 * behind this, and requiring one would lock out everybody who ordered as a
 * guest. All the rules live in the shared service; this only turns its refusal
 * into a status code.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderNumber: string }> },
): Promise<Response> {
  const { orderNumber } = await params;

  /* A malformed body is the same as a missing key: the schema in the service
     rejects it, and it is not worth a distinct failure the client cannot act on
     differently. */
  const body = await request.json().catch(() => null);
  const accessToken = (body as { key?: unknown } | null)?.key;

  const result = await cancelOrderWithToken(
    { orderNumber, accessToken },
    fingerprintFromRequest(request),
  );
  if (!result.ok) return fail(result.code, result.reason);
  return ok({ canceled: true as const });
}
