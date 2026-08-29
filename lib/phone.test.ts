import { describe, expect, it } from "vitest";

import { normalizePhoneE164 } from "./phone";

describe("normalizePhoneE164", () => {
  it("normalizes ten-digit NANP numbers with any common separators", () => {
    expect(normalizePhoneE164("416 555 0142")).toEqual({ ok: true, e164: "+14165550142" });
    expect(normalizePhoneE164("(416) 555-0142")).toEqual({ ok: true, e164: "+14165550142" });
    expect(normalizePhoneE164("416.555.0142")).toEqual({ ok: true, e164: "+14165550142" });
  });

  it("accepts eleven digits with a leading 1", () => {
    expect(normalizePhoneE164("1-416-555-0142")).toEqual({ ok: true, e164: "+14165550142" });
  });

  it("passes through international numbers in + form", () => {
    expect(normalizePhoneE164("+63 917 555 0142")).toEqual({ ok: true, e164: "+639175550142" });
    expect(normalizePhoneE164("+44 20 7946 0958")).toEqual({ ok: true, e164: "+442079460958" });
  });

  it("rejects malformed input with a human message", () => {
    for (const bad of ["", "12345", "041 655 50142", "+0123456789", "letters", "+1"]) {
      const result = normalizePhoneE164(bad);
      expect(result.ok, bad).toBe(false);
    }
  });

  it("rejects NANP area codes that cannot exist", () => {
    expect(normalizePhoneE164("016 555 0142").ok).toBe(false);
    expect(normalizePhoneE164("116 555 0142").ok).toBe(false);
  });
});
