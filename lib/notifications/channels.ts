import "server-only";

import { serverEnv } from "@/lib/env";
import { resolveStoreEmails, resolveStorePhone } from "@/lib/settings/notifications";

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

async function resendConfig(event: NotificationEvent) {
  const env = serverEnv();
  if (!env.RESEND_API_KEY || !env.NOTIFY_FROM_EMAIL) return null;

  return {
    /** May be empty: the store inbox is optional and must not block customer email. */
    storeEmails: await resolveStoreEmails(event.order.pickupLocationId),
    from: env.NOTIFY_FROM_EMAIL,
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
  };
}

/** Store and customer email are separate retry units to prevent partial duplicates. */
export async function sendStoreEmail(event: NotificationEvent): Promise<ChannelResult> {
  const config = await resendConfig(event);
  if (!config || config.storeEmails.length === 0) return skip("email_store");

  const store = renderStoreEmail(event);
  const response = await post("https://api.resend.com/emails", {
    method: "POST",
    headers: config.headers,
    body: JSON.stringify({
      from: config.from,
      to: config.storeEmails,
      subject: store.subject,
      text: store.text,
    }),
  });
  return expectOk(response, "email_store");
}

export async function sendCustomerEmail(event: NotificationEvent): Promise<ChannelResult> {
  const config = await resendConfig(event);
  const customer = renderCustomerEmail(event);
  if (!config || !customer || !event.order.customerEmail) return skip("email_customer");

  const response = await post("https://api.resend.com/emails", {
    method: "POST",
    headers: config.headers,
    body: JSON.stringify({
      from: config.from,
      to: [event.order.customerEmail],
      ...(config.storeEmails[0] ? { reply_to: config.storeEmails[0] } : {}),
      subject: customer.subject,
      text: customer.text,
    }),
  });
  return expectOk(response, "email_customer");
}


/** SMS to the store via Twilio. Customers are emailed, not texted, in v1. */
export async function sendSms(event: NotificationEvent): Promise<ChannelResult> {
  const env = serverEnv();
  const storePhone = await resolveStorePhone(event.order.pickupLocationId);
  if (
    !env.TWILIO_ACCOUNT_SID ||
    !env.TWILIO_AUTH_TOKEN ||
    !env.TWILIO_FROM_NUMBER ||
    !storePhone
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
        To: storePhone,
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

export const CHANNELS: Record<Exclude<ChannelName, "email">,
  (event: NotificationEvent) => Promise<ChannelResult>
> = {
  email_store: sendStoreEmail,
  email_customer: sendCustomerEmail,
  sms: sendSms,
  discord: sendDiscord,
  slack: sendSlack,
  trello: sendTrello,
  webhook: sendWebhook,
};
