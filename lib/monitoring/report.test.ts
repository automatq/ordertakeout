import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
  captureMessage: mocks.captureMessage,
}));

import { reportError } from "./report";

describe("reportError", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SENTRY_DSN;
  });

  afterEach(() => {
    delete process.env.SENTRY_DSN;
  });

  it("always writes the console line and skips Sentry without a DSN", () => {
    const cause = new Error("boom");
    reportError("checkout", "payment sync failed", cause);

    expect(consoleError).toHaveBeenCalledWith("[checkout] payment sync failed:", cause);
    expect(mocks.captureException).not.toHaveBeenCalled();
    expect(mocks.captureMessage).not.toHaveBeenCalled();
  });

  it("captures the cause with scope tag when a DSN is configured", () => {
    process.env.SENTRY_DSN = "https://key@example.ingest.sentry.io/1";
    const cause = new Error("boom");
    reportError("webhooks", "could not record event", cause, { eventId: "evt-1" });

    expect(mocks.captureException).toHaveBeenCalledWith(cause, {
      tags: { scope: "webhooks" },
      extra: { message: "could not record event", eventId: "evt-1" },
    });
  });

  it("captures a message-level report when there is no cause", () => {
    process.env.SENTRY_DSN = "https://key@example.ingest.sentry.io/1";
    reportError("maintenance", "inconsistent payment attempt");

    expect(consoleError).toHaveBeenCalledWith("[maintenance] inconsistent payment attempt");
    expect(mocks.captureMessage).toHaveBeenCalledWith(
      "[maintenance] inconsistent payment attempt",
      { level: "error", tags: { scope: "maintenance" }, extra: undefined },
    );
  });

  it("never throws when the Sentry call itself fails", () => {
    process.env.SENTRY_DSN = "https://key@example.ingest.sentry.io/1";
    mocks.captureException.mockImplementation(() => {
      throw new Error("sentry down");
    });

    expect(() => reportError("orders", "mirror failed", new Error("x"))).not.toThrow();
  });
});
