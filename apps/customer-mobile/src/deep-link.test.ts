import { describe, expect, it } from "vitest";

import { parseDeepLink } from "./deep-link";

const KEY = "c29tZS1zaWduZWQta2V5";

describe("parseDeepLink", () => {
  it("opens an order from the app's own scheme", () => {
    expect(parseDeepLink(`harina://orders/PT-ABC123?key=${KEY}`)).toEqual({
      kind: "order",
      orderNumber: "PT-ABC123",
      accessKey: KEY,
    });
  });

  it("opens an order from the website link", () => {
    /* The confirmation email sends people to the site. Once universal links are
       configured that URL arrives here instead of the browser, and it has to
       mean the same thing. */
    expect(parseDeepLink(`https://harinabakeshoppe.com/orders/PT-ABC123?key=${KEY}`)).toEqual({
      kind: "order",
      orderNumber: "PT-ABC123",
      accessKey: KEY,
    });
  });

  it("opens an order from the short link", () => {
    // The SMS carries /o/ rather than /orders/ because 160 characters is 160.
    expect(parseDeepLink(`https://harinabakeshoppe.com/o/PT-ABC123?key=${KEY}`)).toMatchObject({
      orderNumber: "PT-ABC123",
    });
  });

  it("ignores a link with no key", () => {
    /* Without one there is nothing to show, and landing on a screen that can
       only say no is worse than landing on the menu. */
    expect(parseDeepLink("harina://orders/PT-ABC123")).toBeNull();
    expect(parseDeepLink("https://harinabakeshoppe.com/orders/PT-ABC123")).toBeNull();
  });

  it("ignores links that are not about an order", () => {
    for (const url of [
      "harina://menu",
      `https://harinabakeshoppe.com/?key=${KEY}`,
      `https://harinabakeshoppe.com/products/ensaymada-tray?key=${KEY}`,
      `harina://orders?key=${KEY}`,
    ]) {
      expect(parseDeepLink(url)).toBeNull();
    }
  });

  it("does not throw on rubbish", () => {
    // These arrive from the outside world; a crash on launch is the worst case.
    for (const url of ["", "not a url", "://", "harina://"]) {
      expect(() => parseDeepLink(url)).not.toThrow();
      expect(parseDeepLink(url)).toBeNull();
    }
  });

  it("decodes a percent-encoded order number", () => {
    expect(parseDeepLink(`harina://orders/PT%2DABC123?key=${KEY}`)).toMatchObject({
      orderNumber: "PT-ABC123",
    });
  });

  it("keeps a key containing url-safe base64 characters intact", () => {
    // base64url uses - and _, which must survive the round trip unchanged or
    // every signature check fails.
    const tricky = "abc-DEF_123-xyz_";
    expect(parseDeepLink(`harina://orders/PT-ABC123?key=${tricky}`)).toMatchObject({
      accessKey: tricky,
    });
  });
});
