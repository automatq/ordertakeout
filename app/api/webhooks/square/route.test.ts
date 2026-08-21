import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifySignature: vi.fn(),
  serverEnv: vi.fn(),
  parseSquareEvent: vi.fn(),
  claimEvent: vi.fn(),
  applySquareEvent: vi.fn(),
  markEventProcessed: vi.fn(),
  recordEventError: vi.fn(),
}));

vi.mock("square", () => ({
  WebhooksHelper: { verifySignature: mocks.verifySignature },
}));
vi.mock("@/lib/env", () => ({ serverEnv: mocks.serverEnv }));
vi.mock("@/lib/webhooks/events", () => ({ parseSquareEvent: mocks.parseSquareEvent }));
vi.mock("@/lib/webhooks/apply", () => ({
  applySquareEvent: mocks.applySquareEvent,
  claimEvent: mocks.claimEvent,
  markEventProcessed: mocks.markEventProcessed,
  recordEventError: mocks.recordEventError,
}));

import { POST } from "./route";

const EVENT = {
  kind: "fulfillment" as const,
  eventId: "evt-1",
  type: "order.fulfillment.updated",
  squareOrderId: "SQ-1",
  newState: "PREPARED",
};

function request(): Request {
  return new Request("https://example.com/api/webhooks/square", {
    method: "POST",
    headers: { "x-square-hmacsha256-signature": "valid" },
    body: JSON.stringify({ event_id: EVENT.eventId }),
  });
}

describe("Square webhook retry outcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serverEnv.mockReturnValue({
      SQUARE_WEBHOOK_SIGNATURE_KEY: "secret",
      SQUARE_WEBHOOK_NOTIFICATION_URL: "https://example.com/api/webhooks/square",
    });
    mocks.verifySignature.mockResolvedValue(true);
    mocks.parseSquareEvent.mockReturnValue({ ok: true, event: EVENT });
    mocks.claimEvent.mockResolvedValue({ status: "claimed" });
    mocks.markEventProcessed.mockResolvedValue(undefined);
    mocks.recordEventError.mockResolvedValue(undefined);
  });

  it("leaves a deferred event unprocessed and asks Square to retry", async () => {
    mocks.applySquareEvent.mockResolvedValue({
      handled: false,
      retryable: true,
      detail: "payment has not reconciled yet",
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(mocks.recordEventError).toHaveBeenCalledWith(
      EVENT.eventId,
      "payment has not reconciled yet",
    );
    expect(mocks.markEventProcessed).not.toHaveBeenCalled();
  });

  it.each([
    { handled: true, detail: "applied" },
    { handled: false, detail: "unrelated event" },
  ])("marks a terminal outcome processed ($detail)", async (outcome) => {
    mocks.applySquareEvent.mockResolvedValue(outcome);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.markEventProcessed).toHaveBeenCalledWith(EVENT.eventId);
    expect(mocks.recordEventError).not.toHaveBeenCalled();
  });
});
