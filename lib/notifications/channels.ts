import "server-only";

import { serverEnv } from "@/lib/env";

import {
  renderCustomerEmail,
  renderDiscord,
  renderSlack,
  renderStoreEmail,
  renderStoreSms,
  renderTrello,
  renderWebhook,
} from "./render";
import type { ChannelName, ChannelResult, NotificationEvent } from "./types";

/**
 * Channel adapters.
 *
 * Every one is a plain `fetch` against the provider's HTTP API rather than an
 * SDK. Six vendor SDKs would be six dependency trees to keep current for what
 * amounts to six POST requests, and going direct keeps each adapter small enough
 * to read in one sitting.
 *
 * A channel with no configuration is *skipped*, not failed — that's how the store
 * turns one on later without a code change.
 */

const TIMEOUT_MS = 10_000;

/** Never let a hanging provider stall the request that triggered it. */
async function post(
  url: string,
  init: RequestInit & { headers?: Record<string, string> },
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

const ok = (channel: ChannelName): ChannelResult => ({ channel, ok: true });
const skip = (channel: ChannelName): ChannelResult => ({ channel, ok: true, skipped: true });
const fail = (channel: ChannelName, error: string): ChannelResult => ({
  channel,
  ok: false,
  error,
});

async function expectOk(response: Response, channel: ChannelName): Promise<ChannelResult> {
  if (response.ok) return ok(channel);
  const body = await response.text().catch(() => "");
  return fail(channel, `HTTP ${response.status}: ${body.slice(0, 200)}`);
}

/* -------------------------------------------------------------------------- */

/** Email via Resend. Sends to the store and, separately, to the customer. */
export async function sendEmail(event: NotificationEvent): Promise<ChannelResult> {
  const env = serverEnv();
  if (!env.RESEND_API_KEY || !env.STORE_NOTIFY_EMAIL) return skip("email");

  const headers = {
    Authorization: `Bearer ${env.RESEND_API_KEY}`,
    "Content-Type": "application/json",
  };
  const from = `Party Tray Orders <orders@${emailDomain(env.STORE_NOTIFY_EMAIL)}>`;

  const store = renderStoreEmail(event);
  const customer = renderCustomerEmail(event);

  const sends = [
    post("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from,
        to: [env.STORE_NOTIFY_EMAIL],
        subject: store.subject,
        text: store.text,
      }),
    }),
    ...(customer
      ? [
          post("https://api.resend.com/emails", {
            method: "POST",
            headers,
            body: JSON.stringify({
              from,
              to: [event.order.customerEmail],
              // So a customer replying reaches the shop, not a no-reply void.
              reply_to: env.STORE_NOTIFY_EMAIL,
              subject: customer.subject,
              text: customer.text,
            }),
          }),
        ]
      : []),
  ];

  const results = await Promise.allSettled(sends);
  const failures = results.filter(
    (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok),
  );

  if (failures.length === 0) return ok("email");
  return fail("email", `${failures.length} of ${results.length} emails failed`);
}

/** Domain for the From address. Configurable later; verified in Resend either way. */
function emailDomain(storeEmail: string): string {
  return storeEmail.split("@")[1] ?? "example.com";
}

/** SMS to the store via Twilio. Customers are emailed, not texted, in v1. */
export async function sendSms(event: NotificationEvent): Promise<ChannelResult> {
  const env = serverEnv();
  if (
    !env.TWILIO_ACCOUNT_SID ||
    !env.TWILIO_AUTH_TOKEN ||
    !env.TWILIO_FROM_NUMBER ||
    !env.STORE_NOTIFY_PHONE
  ) {
    return skip("sms");
  }

  const credentials = Buffer.from(
    `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`,
  ).toString("base64");

  const response = await post(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: env.STORE_NOTIFY_PHONE,
        From: env.TWILIO_FROM_NUMBER,
        Body: renderStoreSms(event),
      }).toString(),
    },
  );

  return expectOk(response, "sms");
}

export async function sendDiscord(event: NotificationEvent): Promise<ChannelResult> {
  const url = serverEnv().DISCORD_WEBHOOK_URL;
  if (!url) return skip("discord");

  const response = await post(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(renderDiscord(event)),
  });
  return expectOk(response, "discord");
}

export async function sendSlack(event: NotificationEvent): Promise<ChannelResult> {
  const url = serverEnv().SLACK_WEBHOOK_URL;
  if (!url) return skip("slack");

  const response = await post(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(renderSlack(event)),
  });
  return expectOk(response, "slack");
}

/** A card per order on the store's "Pickup Orders" board. */
export async function sendTrello(event: NotificationEvent): Promise<ChannelResult> {
  const env = serverEnv();
  if (!env.TRELLO_KEY || !env.TRELLO_TOKEN || !env.TRELLO_LIST_ID) return skip("trello");

  const card = renderTrello(event);
  const params = new URLSearchParams({
    key: env.TRELLO_KEY,
    token: env.TRELLO_TOKEN,
    idList: env.TRELLO_LIST_ID,
    name: card.name,
    desc: card.desc,
    // Trello shows a due date on the card front — the pickup time is the useful one.
    due: `${event.order.pickupDate}T${event.order.pickupTime}:00`,
  });

  const response = await post(`https://api.trello.com/1/cards?${params.toString()}`, {
    method: "POST",
  });
  return expectOk(response, "trello");
}

/** The store's own endpoint — lets them wire this into anything later. */
export async function sendWebhook(event: NotificationEvent): Promise<ChannelResult> {
  const url = serverEnv().CUSTOM_WEBHOOK_URL;
  if (!url) return skip("webhook");

  const response = await post(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(renderWebhook(event)),
  });
  return expectOk(response, "webhook");
}

export const CHANNELS: Record<
  ChannelName,
  (event: NotificationEvent) => Promise<ChannelResult>
> = {
  email: sendEmail,
  sms: sendSms,
  discord: sendDiscord,
  slack: sendSlack,
  trello: sendTrello,
  webhook: sendWebhook,
};
