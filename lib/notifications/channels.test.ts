import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { NotificationEvent } from "./types";

/**
 * Verifies the channel adapters make the HTTP calls they claim to.
 *
 * `fetch` is stubbed rather than mocking a client library, which is the point of
 * going direct to each provider's HTTP API: the request is the whole contract, so
 * asserting on it is asserting on everything that matters.
 */

const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://localhost:5432/test",
  STORE_TIMEZONE: "America/Los_Angeles",
  STORE_CURRENCY: "USD",
  SQUARE_ACCESS_TOKEN: "sq-token",
  SQUARE_WEBHOOK_SIGNATURE_KEY: "sq-sig",
  SQUARE_WEBHOOK_NOTIFICATION_URL: "https://example.com/api/webhooks/square",
  STAFF_DASHBOARD_PASSWORD: "kitchen-secret",
};

const CHANNEL_ENV = {
  RESEND_API_KEY: "re_test",
  NOTIFY_FROM_EMAIL: "Party Tray Orders <orders@bakery.test>",
  STORE_NOTIFY_EMAIL: "orders@bakery.test",
  TWILIO_ACCOUNT_SID: "AC123",
  TWILIO_AUTH_TOKEN: "twilio-token",
  TWILIO_FROM_NUMBER: "+15550000000",
  STORE_NOTIFY_PHONE: "+15551111111",
  DISCORD_WEBHOOK_URL: "https://discord.test/webhook",
  SLACK_WEBHOOK_URL: "https://slack.test/webhook",
  TRELLO_KEY: "trello-key",
  TRELLO_TOKEN: "trello-token",
  TRELLO_LIST_ID: "list-1",
  CUSTOM_WEBHOOK_URL: "https://store.test/hook",
};

beforeAll(() => {
  for (const [key, value] of Object.entries({ ...REQUIRED_ENV, ...CHANNEL_ENV })) {
    vi.stubEnv(key, value);
  }
});

afterEach(() => vi.unstubAllGlobals());

const EVENT: NotificationEvent = {
  kind: "order_paid",
  order: {
    orderId: "11111111-1111-4111-8111-111111111111",
    orderNumber: "PT-K7M2QX",
    customerName: "Maria Santos",
    customerEmail: "maria@example.com",
    customerPhone: "+15551234567",
    pickupDate: "2026-03-05",
    pickupTime: "16:00",
    totalCents: 7000,
    currency: "USD",
    items: [{ quantity: 2, name: "Ensaymada — 25 pcs Ube" }],
    note: null,
  },
};

interface Captured {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: string;
}

function stubFetch(status = 200): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return new Response(status === 200 ? "{}" : "provider is down", { status });
  });
  return calls;
}

describe("Discord", () => {
  it("posts an embed to the configured webhook", async () => {
    const calls = stubFetch();
    const { sendDiscord } = await import("./channels");

    expect(await sendDiscord(EVENT)).toEqual({ channel: "discord", ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://discord.test/webhook");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body!)).toHaveProperty("embeds");
  });

  it("reports a provider failure instead of throwing", async () => {
    stubFetch(500);
    const { sendDiscord } = await import("./channels");

    const result = await sendDiscord(EVENT);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("500");
  });
});

describe("Slack", () => {
  it("posts blocks with fallback text", async () => {
    const calls = stubFetch();
    const { sendSlack } = await import("./channels");

    expect((await sendSlack(EVENT)).ok).toBe(true);
    const payload = JSON.parse(calls[0]!.body!);
    expect(payload.text).toContain("PT-K7M2QX");
    expect(payload.blocks.length).toBeGreaterThan(0);
  });
});

describe("Twilio", () => {
  it("posts form-encoded SMS with basic auth", async () => {
    const calls = stubFetch();
    const { sendSms } = await import("./channels");

    expect((await sendSms(EVENT)).ok).toBe(true);
    expect(calls[0]?.url).toContain("/Accounts/AC123/Messages.json");
    expect(calls[0]?.headers["Authorization"]).toMatch(/^Basic /);
    expect(calls[0]?.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

    const body = new URLSearchParams(calls[0]!.body!);
    expect(body.get("To")).toBe("+15551111111");
    expect(body.get("From")).toBe("+15550000000");
    expect(body.get("Body")).toContain("PT-K7M2QX");
  });
});

describe("Resend", () => {
  it("emails the store and the customer as independently retryable channels", async () => {
    const calls = stubFetch();
    const { sendStoreEmail, sendCustomerEmail } = await import("./channels");

    expect(await sendStoreEmail(EVENT)).toEqual({ channel: "email_store", ok: true });
    expect(await sendCustomerEmail(EVENT)).toEqual({ channel: "email_customer", ok: true });
    expect(calls).toHaveLength(2);

    const recipients = calls.map((c) => JSON.parse(c.body!).to[0]);
    expect(recipients).toEqual(
      expect.arrayContaining(["orders@bakery.test", "maria@example.com"]),
    );
    expect(calls[0]?.headers["Authorization"]).toBe("Bearer re_test");
  });

  it("fails each recipient independently", async () => {
    stubFetch(500);
    const { sendStoreEmail, sendCustomerEmail } = await import("./channels");
    expect((await sendStoreEmail(EVENT)).channel).toBe("email_store");
    expect((await sendStoreEmail(EVENT)).ok).toBe(false);
    expect((await sendCustomerEmail(EVENT)).channel).toBe("email_customer");
    expect((await sendCustomerEmail(EVENT)).ok).toBe(false);
  });
});

describe("Trello", () => {
  it("creates a card with the pickup time as the due date", async () => {
    const calls = stubFetch();
    const { sendTrello } = await import("./channels");

    expect((await sendTrello(EVENT)).ok).toBe(true);
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("idList")).toBe("list-1");
    expect(url.searchParams.get("name")).toContain("PT-K7M2QX");
    expect(url.searchParams.get("due")).toBe("2026-03-05T16:00:00");
  });
});

describe("generic webhook", () => {
  it("posts the documented JSON shape", async () => {
    const calls = stubFetch();
    const { sendWebhook } = await import("./channels");

    expect((await sendWebhook(EVENT)).ok).toBe(true);
    const payload = JSON.parse(calls[0]!.body!);
    expect(payload.event).toBe("order_paid");
    expect(payload.order.number).toBe("PT-K7M2QX");
  });
});

describe("unconfigured channels", () => {
  it("are skipped without making a request", async () => {
    // The whole point of optional config: the store enables a channel later
    // without a code change, and until then nothing is attempted or logged.
    for (const key of Object.keys(CHANNEL_ENV)) vi.stubEnv(key, "");

    const calls = stubFetch();
    vi.resetModules();
    const channels = await import("./channels");

    for (const send of Object.values(channels.CHANNELS)) {
      const result = await send(EVENT);
      expect(result).toMatchObject({ ok: true, skipped: true });
    }
    expect(calls).toHaveLength(0);

    for (const [key, value] of Object.entries(CHANNEL_ENV)) vi.stubEnv(key, value);
    vi.resetModules();
  });
});
