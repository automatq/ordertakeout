import { describe, expect, it } from "vitest";

import { PRODUCT_IMAGE_CSP_SOURCES } from "../catalog/image-policy";
import {
  buildContentSecurityPolicy,
  sentryIngestOriginFromDsn,
} from "./content-security-policy";

function directive(policy: string, name: string): string[] {
  const match = policy
    .split("; ")
    .map((entry) => entry.split(" "))
    .find(([candidate]) => candidate === name);
  return match?.slice(1) ?? [];
}

describe("Square Web Payments CSP", () => {
  it("allows only the documented Sandbox payment origins in Sandbox", () => {
    const policy = buildContentSecurityPolicy({ production: true, squareEnvironment: "sandbox" });

    expect(directive(policy, "script-src")).toContain("https://sandbox.web.squarecdn.com");
    expect(directive(policy, "frame-src")).toContain("https://sandbox.web.squarecdn.com");
    expect(directive(policy, "connect-src")).toEqual([
      "'self'",
      "https://sandbox.web.squarecdn.com",
      "https://pci-connect.squareupsandbox.com",
      "https://o160250.ingest.sentry.io",
      "https://pay.google.com",
      "https://google.com/pay",
      "https://api.cash.app",
    ]);
    expect(policy).not.toContain("https://web.squarecdn.com");
    expect(policy).not.toContain("https://pci-connect.squareup.com");
  });

  it("allows only the documented production payment origins in production", () => {
    const policy = buildContentSecurityPolicy({ production: true, squareEnvironment: "production" });

    expect(directive(policy, "script-src")).toContain("https://web.squarecdn.com");
    expect(directive(policy, "frame-src")).toContain("https://web.squarecdn.com");
    expect(directive(policy, "connect-src")).toEqual([
      "'self'",
      "https://web.squarecdn.com",
      "https://pci-connect.squareup.com",
      "https://o160250.ingest.sentry.io",
      "https://pay.google.com",
      "https://google.com/pay",
      "https://api.cash.app",
    ]);
    expect(policy).not.toContain("sandbox.web.squarecdn.com");
    expect(policy).not.toContain("pci-connect.squareupsandbox.com");
  });

  it("allows WebAssembly compilation in production for the QR decoder", () => {
    // The staff scanner's fallback decoder is WASM. Chrome blocks
    // WebAssembly under CSP unless script-src permits it, and production has
    // no 'unsafe-eval' to fall back on — so without this the scanner fails
    // only in production, on exactly the browsers that needed the fallback.
    const production = buildContentSecurityPolicy({
      production: true,
      squareEnvironment: "production",
    });
    expect(directive(production, "script-src")).toContain("'wasm-unsafe-eval'");
    // Narrower than unsafe-eval on purpose: WASM only, no JS eval.
    expect(directive(production, "script-src")).not.toContain("'unsafe-eval'");
  });

  it("allows unsafe-eval only for Next development tooling", () => {
    expect(
      buildContentSecurityPolicy({ production: false, squareEnvironment: "sandbox" }),
    ).toContain("'unsafe-eval'");
    expect(
      buildContentSecurityPolicy({ production: true, squareEnvironment: "sandbox" }),
    ).not.toContain("'unsafe-eval'");
  });

  it("allows the app's own Sentry ingest origin only when configured", () => {
    const withSentry = buildContentSecurityPolicy({
      production: true,
      squareEnvironment: "sandbox",
      sentryIngestOrigin: "https://o999.ingest.us.sentry.io",
    });
    expect(directive(withSentry, "connect-src")).toContain("https://o999.ingest.us.sentry.io");

    const without = buildContentSecurityPolicy({ production: true, squareEnvironment: "sandbox" });
    expect(directive(without, "connect-src")).not.toContain("https://o999.ingest.us.sentry.io");
  });

  it("derives the ingest origin from a DSN and rejects garbage", () => {
    expect(
      sentryIngestOriginFromDsn("https://abc123@o999.ingest.us.sentry.io/4507000000000000"),
    ).toBe("https://o999.ingest.us.sentry.io");
    expect(sentryIngestOriginFromDsn(undefined)).toBeNull();
    expect(sentryIngestOriginFromDsn("")).toBeNull();
    expect(sentryIngestOriginFromDsn("not a url")).toBeNull();
  });

  it("keeps image CSP sources aligned with the Next/Image allowlist", () => {
    const policy = buildContentSecurityPolicy({ production: true, squareEnvironment: "sandbox" });
    const imageSources = directive(policy, "img-src");

    for (const source of PRODUCT_IMAGE_CSP_SOURCES) expect(imageSources).toContain(source);
    expect(imageSources).not.toContain("https://*.amazonaws.com");
  });
});
