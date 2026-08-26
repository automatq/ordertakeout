import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({ STORE_PUBLIC_URL: undefined }) }));

import { deriveRelyingParty } from "./passkeys";

describe("deriveRelyingParty", () => {
  it("scopes credentials to the apex domain, not www", () => {
    /* One-way decision: a credential enrolled against www cannot later be used
       on the apex, or by a native app claiming the apex. Scoping to the apex
       now is what keeps every enrolled passkey working if the site ever drops
       or adds the subdomain. */
    expect(deriveRelyingParty("https://www.harinabakeshoppe.com")).toEqual({
      rpID: "harinabakeshoppe.com",
      origins: ["https://harinabakeshoppe.com", "https://www.harinabakeshoppe.com"],
    });
  });

  it("produces the same relying party from either form of the URL", () => {
    // Changing STORE_PUBLIC_URL between the two must not orphan credentials.
    expect(deriveRelyingParty("https://harinabakeshoppe.com")).toEqual(
      deriveRelyingParty("https://www.harinabakeshoppe.com"),
    );
  });

  it("accepts both origins so a customer on www can still sign in", () => {
    const rp = deriveRelyingParty("https://harinabakeshoppe.com")!;
    expect(rp.origins).toContain("https://harinabakeshoppe.com");
    expect(rp.origins).toContain("https://www.harinabakeshoppe.com");
  });

  it("keeps a deeper subdomain intact", () => {
    // Only a leading www is redundant; order.example.com is a real host.
    expect(deriveRelyingParty("https://order.example.com")?.rpID).toBe("order.example.com");
  });

  it("keeps the scheme and the port, which are both part of the origin", () => {
    // A dropped port makes every verification fail on any deployment not
    // served from 443 — the browser reports the origin with it.
    const rp = deriveRelyingParty("http://localhost:3000")!;
    expect(rp.rpID).toBe("localhost");
    expect(rp.origins[0]).toBe("http://localhost:3000");
  });

  it("yields nothing without a usable public URL", () => {
    // Callers hide the passkey UI rather than offering something that will fail.
    expect(deriveRelyingParty(null)).toBeNull();
    expect(deriveRelyingParty(undefined)).toBeNull();
    expect(deriveRelyingParty("")).toBeNull();
    expect(deriveRelyingParty("not a url")).toBeNull();
  });
});
