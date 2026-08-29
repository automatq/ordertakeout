import { createAccountSessionToken } from "@/lib/accounts/session";
import { verifyPhoneCode } from "@/lib/accounts/phone-auth";
import { fail, ok } from "@/lib/api/envelope";

/**
 * Exchange a texted code for a bearer token.
 *
 * The website sets an httpOnly cookie at this point; a phone cannot use one, so
 * it gets the same signed token in the body instead. Same secret, same expiry,
 * same verification — one notion of "signed in as this customer" rather than
 * two that drift.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Enter the 6-digit code we texted you.");
  }

  const result = await verifyPhoneCode(body);
  /* Wrong code and expired code are one message on purpose: distinguishing them
     tells somebody guessing whether they are close. */
  if (!result.ok) return ok({ signedIn: false, message: result.message });

  /* Verified, but nobody has this number yet. The app collects a name and an
     email and posts them to /account/profile with this token, which is the only
     thing that proves the number was answered. */
  if (result.accountId === null) {
    return ok({ signedIn: false, needsProfile: true, phone: result.phone, signupToken: result.signupToken });
  }

  return ok({
    signedIn: true,
    token: await createAccountSessionToken(result.accountId),
  });
}
