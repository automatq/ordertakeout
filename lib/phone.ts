/**
 * Phone normalization to E.164 — dependency-free, shared by the checkout
 * form's client validation and the server-side zod schema (no `server-only`
 * on purpose).
 *
 * Scope is deliberately modest: strict enough that Twilio will accept what we
 * store, permissive enough not to reject a real customer. NANP ten-digit
 * numbers (the store's customers) get `+1`; anything already in `+` form is
 * checked against E.164's shape. This is a formatter, not a line-type lookup.
 */

export type PhoneParseResult =
  | { ok: true; e164: string }
  | { ok: false; message: string };

export function normalizePhoneE164(input: string, defaultRegion: "CA" | "US" = "CA"): PhoneParseResult {
  void defaultRegion; // Both NANP; the parameter documents intent for future regions.
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, message: "Enter a phone number." };

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (hasPlus) {
    // E.164: up to 15 digits, no leading zero.
    if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) {
      return { ok: false, message: "That international number doesn't look right." };
    }
    return { ok: true, e164: `+${digits}` };
  }

  if (digits.length === 10) {
    if (digits[0] === "0" || digits[0] === "1") {
      return { ok: false, message: "That phone number doesn't look right." };
    }
    return { ok: true, e164: `+1${digits}` };
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    if (digits[1] === "0" || digits[1] === "1") {
      return { ok: false, message: "That phone number doesn't look right." };
    }
    return { ok: true, e164: `+${digits}` };
  }

  return {
    ok: false,
    message: "Enter a 10-digit phone number, or use +country-code for international numbers.",
  };
}
