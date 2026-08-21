import { describe, expect, it } from "vitest";

import { PRODUCT_IMAGE_CSP_SOURCES } from "../catalog/image-policy";
import { buildContentSecurityPolicy } from "./content-security-policy";

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
    ]);
    expect(policy).not.toContain("sandbox.web.squarecdn.com");
    expect(policy).not.toContain("pci-connect.squareupsandbox.com");
  });

  it("allows unsafe-eval only for Next development tooling", () => {
    expect(
      buildContentSecurityPolicy({ production: false, squareEnvironment: "sandbox" }),
    ).toContain("'unsafe-eval'");
    expect(
      buildContentSecurityPolicy({ production: true, squareEnvironment: "sandbox" }),
    ).not.toContain("'unsafe-eval'");
  });

  it("keeps image CSP sources aligned with the Next/Image allowlist", () => {
    const policy = buildContentSecurityPolicy({ production: true, squareEnvironment: "sandbox" });
    const imageSources = directive(policy, "img-src");

    for (const source of PRODUCT_IMAGE_CSP_SOURCES) expect(imageSources).toContain(source);
    expect(imageSources).not.toContain("https://*.amazonaws.com");
  });
});
