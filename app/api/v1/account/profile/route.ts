import {
  createPhoneProfile,
  getProfile,
  profileFieldsSchema,
  updateProfile,
  type CustomerProfile,
} from "@/lib/accounts/profile";
import { createAccountSessionToken } from "@/lib/accounts/session";
import { phoneFromSignupToken } from "@/lib/accounts/signup-token";
import { customerAccountFromRequest } from "@/lib/api/context";
import { fail, ok, unauthorized } from "@/lib/api/envelope";
import { profileResponseSchema, toProfileResponse } from "@/lib/api/dto";

/**
 * The customer's own details.
 *
 * The app had no way to learn its customer's name — the account screen was
 * headed with a bare "Account" and checkout opened with empty fields, because
 * every other endpoint returns orders or points and none returns the person.
 */

export async function GET(request: Request): Promise<Response> {
  const accountId = await customerAccountFromRequest(request);
  if (!accountId) return unauthorized();

  const profile = await getProfile(accountId);
  if (!profile) return unauthorized();

  return ok(toProfileResponse(profile));
}

/**
 * Create an account for a number that just answered a texted code.
 *
 * Unauthenticated by design — the signup token *is* the authentication, and a
 * customer signing up has no session yet. Returns one, so the app is signed in
 * the moment the profile exists.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Please check the details and try again.");
  }

  const token = (body as { signupToken?: unknown })?.signupToken;
  const phone = await phoneFromSignupToken(typeof token === "string" ? token : undefined);
  if (!phone) return fail("invalid_request", "That took too long. Request a new code and try again.");

  const fields = profileFieldsSchema.safeParse(body);
  if (!fields.success) {
    return fail("invalid_request", fields.error.issues[0]?.message ?? "Please check the details.");
  }

  const created = await createPhoneProfile({ phone, fields: fields.data });
  if (!created.ok) return fail("invalid_request", created.message);

  return ok({
    ...toProfileResponse(created.profile),
    token: await createAccountSessionToken(created.accountId),
  });
}

export async function PATCH(request: Request): Promise<Response> {
  const accountId = await customerAccountFromRequest(request);
  if (!accountId) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Please check the details and try again.");
  }

  const fields = editSchema.safeParse(body);
  if (!fields.success) {
    return fail("invalid_request", fields.error.issues[0]?.message ?? "Please check the details.");
  }

  const result = await updateProfile(accountId, fields.data);
  if (!result.ok) return fail("invalid_request", result.message);

  return ok(toProfileResponse(result.profile));
}

const editSchema = profileFieldsSchema.partial().extend({
  smsOptIn: profileResponseSchema.shape.smsOptIn.optional(),
});

export type { CustomerProfile };
