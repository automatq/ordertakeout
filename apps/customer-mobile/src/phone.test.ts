import { describe, expect, it } from "vitest";

import { formatPhoneForDisplay, normalizePhoneE164 } from "./phone";

/**
 * These vectors are duplicated from the web's lib/phone.ts contract on purpose.
 * The app carries its own copy of the normalizer, and the only thing stopping
 * the two drifting is a test that fails when they disagree.
 */
describe("normalizePhoneE164", () => {
  it("gives a NANP ten-digit number the +1 the server stores", () => {
    for (const input of ["4165550142", "416-555-0142", "(416) 555 0142"]) {
      expect(normalizePhoneE164(input)).toEqual({ ok: true, e164: "+14165550142" });
    }
  });

  it("accepts an already-prefixed eleven-digit number", () => {
    expect(normalizePhoneE164("1 416 555 0142")).toEqual({ ok: true, e164: "+14165550142" });
  });

  it("keeps an international number as given", () => {
    expect(normalizePhoneE164("+63 917 555 0142")).toEqual({ ok: true, e164: "+639175550142" });
  });

  it("refuses numbers that cannot be dialled", () => {
    for (const bad of ["", "   ", "555", "0165550142", "1165550142", "+0123456789", "+123"]) {
      expect(normalizePhoneE164(bad).ok).toBe(false);
    }
  });
});

describe("formatPhoneForDisplay", () => {
  it("makes a stored number readable", () => {
    expect(formatPhoneForDisplay("+14165550142")).toBe("(416) 555-0142");
  });

  it("leaves anything it does not recognise alone", () => {
    expect(formatPhoneForDisplay("+639175550142")).toBe("+639175550142");
  });
});
