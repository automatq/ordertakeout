/**
 * Phone normalization to E.164.
 *
 * A copy of the web's lib/phone.ts, deliberately. The app is a separate Expo
 * package with its own tsconfig and cannot import across the workspace root,
 * and this is forty lines of pure string handling with no dependencies. The
 * shared test vectors in phone.test.ts are what keep the two honest — if this
 * drifts, a number typed in the app and the same number typed on the web stop
 * resolving to the same account.
 *
 * Scope is deliberately modest: strict enough that Twilio will accept what we
 * store, permissive enough not to reject a real customer.
 */

export type PhoneParseResult =
  | { ok: true; e164: string }
  | { ok: false; message: string };

export function normalizePhoneE164(input: string): PhoneParseResult {
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

/** `+14165550142` → `(416) 555-0142`. Display only; never sent to the server. */
export function formatPhoneForDisplay(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : e164;
}
