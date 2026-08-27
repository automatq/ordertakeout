import { fail, ok } from "@/lib/api/envelope";
import { requestPhoneCode } from "@/lib/accounts/phone-auth";

/**
 * Text a sign-in code.
 *
 * The response is the same sentence whether or not the number has an account,
 * and the text is sent in `after()` so the response time does not answer the
 * question either — a Twilio round-trip is a very loud signal to leave in a
 * latency measurement. Both properties belong to lib/accounts/phone-auth.ts,
 * which the website's own sign-in form also calls.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Enter the mobile number you order with.");
  }

  const result = await requestPhoneCode(body);
  /* A refusal here is rate limiting or a malformed number — both are things to
     read on screen, not conditions the client should branch on. */
  return result.ok
    ? ok({ sent: true, message: result.message })
    : ok({ sent: false, message: result.message });
}
