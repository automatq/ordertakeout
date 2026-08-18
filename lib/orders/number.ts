/**
 * Human-readable order references, e.g. `PT-K7M2QX`.
 *
 * Random rather than sequential for two reasons: customers look their order up
 * by number, so sequential references would let anyone enumerate other people's
 * orders; and staff read these aloud across a counter, so the alphabet omits
 * characters that get misheard or misread (0/O, 1/I/L).
 */

/** 31 unambiguous characters — no 0, O, 1, I or L. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;

/**
 * Largest multiple of the alphabet length that fits in a byte.
 *
 * Bytes at or above this are discarded rather than folded with `%`, which would
 * make the first few characters slightly more likely. Rejection sampling keeps
 * the distribution exactly uniform for any alphabet length, so the alphabet can
 * be edited later without re-deriving the bias argument.
 */
const REJECTION_LIMIT = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

export function generateOrderNumber(): string {
  let code = "";
  while (code.length < CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(CODE_LENGTH))) {
      if (byte >= REJECTION_LIMIT) continue;
      code += ALPHABET[byte % ALPHABET.length];
      if (code.length === CODE_LENGTH) break;
    }
  }
  return `PT-${code}`;
}

const ORDER_NUMBER_PATTERN = new RegExp(`^PT-[${ALPHABET}]{${CODE_LENGTH}}$`);

export function isOrderNumber(value: string): boolean {
  return ORDER_NUMBER_PATTERN.test(value.trim().toUpperCase());
}

/** Accept what a customer actually types — lowercase, no prefix, stray spaces. */
export function normalizeOrderNumber(value: string): string {
  const cleaned = value.trim().toUpperCase().replace(/\s+/g, "").replace(/^PT-?/, "");
  return `PT-${cleaned}`;
}
