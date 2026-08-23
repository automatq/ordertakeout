import { formatPickupTime, formatStoreDate } from "@/lib/scheduling/time";
import { formatMoney } from "@/lib/square/money";

import type { NotificationEvent, OrderNotification } from "./types";

/**
 * Message rendering for every channel.
 *
 * Pure, so the wording, the SMS length budget and the JSON shapes can all be
 * tested without sending anything to anyone.
 */

/** SMS is billed per 160-character segment, so the store message stays inside one. */
export const SMS_SEGMENT_LIMIT = 160;

export const pickupLine = (order: OrderNotification): string =>
  `${formatStoreDate(order.pickupDate, "medium")} at ${formatPickupTime(order.pickupTime)}${order.pickupLocationName ? ` — ${order.pickupLocationName}` : ""}`;

export const itemLines = (order: OrderNotification): string[] =>
  order.items.map((item) => `${item.quantity}x ${item.name}`);

const total = (order: OrderNotification) => formatMoney(order.totalCents, order.currency);

/** What the card was charged: order total plus tip. */
const charged = (order: OrderNotification) =>
  formatMoney(order.totalCents + (order.tipCents ?? 0), order.currency)
  + ((order.tipCents ?? 0) > 0 ? ` (includes ${formatMoney(order.tipCents ?? 0, order.currency)} tip)` : "");

const refundAmount = (event: NotificationEvent) =>
  formatMoney(event.refund?.amountCents ?? event.order.totalCents, event.order.currency);

/* -------------------------------------------------------------------------- */
/* To the store                                                               */
/* -------------------------------------------------------------------------- */

export function renderStoreEmail(event: NotificationEvent): { subject: string; text: string } {
  const { order } = event;
  const heading =
    event.kind === "order_paid"
      ? `New paid order ${order.orderNumber}`
      : event.kind === "order_canceled"
        ? `Order ${order.orderNumber} cancelled`
        : event.kind === "order_refunded"
          ? `Refund of ${refundAmount(event)} issued on order ${order.orderNumber}`
          : `Order ${order.orderNumber} ready`;

  const text = [
    heading,
    "",
    `Pickup:   ${pickupLine(order)}`,
    `Customer: ${order.customerName}`,
    `Phone:    ${order.customerPhone}`,
    `Email:    ${order.customerEmail}`,
    "",
    "Items:",
    ...itemLines(order).map((line) => `  ${line}`),
    "",
    `Total:    ${total(order)}${event.kind === "order_paid" ? " (PAID ONLINE)" : ""}`,
    ...(order.note ? ["", `Note: ${order.note}`] : []),
  ].join("\n");

  return { subject: `${heading} — pickup ${pickupLine(order)}`, text };
}

/**
 * The store's text message.
 *
 * Deliberately terse and truncated to one SMS segment. A staff member reading
 * this on a phone in a hot kitchen needs order number, when, and what — the full
 * detail is a tap away on the dashboard.
 */
export function renderStoreSms(event: NotificationEvent): string {
  const { order } = event;
  const prefix =
    event.kind === "order_paid"
      ? "NEW ORDER"
      : event.kind === "order_canceled"
        ? "CANCELLED"
        : event.kind === "order_refunded"
          ? "REFUNDED"
          : "READY";

  const head = `${prefix} ${order.orderNumber} - ${pickupLine(order)} - ${total(order)}`;
  const items = itemLines(order);

  // Add items only while they fit; never spill into a second segment.
  let message = head;
  for (const [index, line] of items.entries()) {
    const remaining = items.length - index;
    const candidate = `${message} - ${line}`;
    const suffix = remaining > 1 ? ` +${remaining - 1} more` : "";
    if (candidate.length + suffix.length > SMS_SEGMENT_LIMIT) {
      const withCount = `${message} +${remaining} more`;
      return withCount.length <= SMS_SEGMENT_LIMIT ? withCount : message;
    }
    message = candidate;
  }
  return message;
}

/* -------------------------------------------------------------------------- */
/* To the customer                                                            */
/* -------------------------------------------------------------------------- */

export function renderCustomerEmail(
  event: NotificationEvent,
): { subject: string; text: string } | null {
  const { order } = event;

  switch (event.kind) {
    case "order_paid":
      return {
        subject: `Order confirmed — ${order.orderNumber}`,
        text: [
          `Thanks ${order.customerName}, your order is confirmed.`,
          "",
          `Order:  ${order.orderNumber}`,
          `Pickup: ${pickupLine(order)}`,
          "",
          "Items:",
          ...itemLines(order).map((line) => `  ${line}`),
          "",
          `Paid:   ${charged(order)}`,
          "",
          "Please collect in store at your chosen time. Bring your order number.",
          ...(order.trackingUrl ? ["", `Track your order: ${order.trackingUrl}`] : []),
        ].join("\n"),
      };

    case "order_ready":
      return {
        subject: `Your order ${order.orderNumber} is ready`,
        text: [
          `Hi ${order.customerName}, your order is ready for pickup.`,
          "",
          `Order:  ${order.orderNumber}`,
          `Pickup: ${pickupLine(order)}`,
          "",
          "See you soon!",
          ...(order.trackingUrl ? ["", `Order details: ${order.trackingUrl}`] : []),
        ].join("\n"),
      };

    case "order_canceled":
      return {
        subject: `Order ${order.orderNumber} cancelled`,
        text: [
          `Hi ${order.customerName}, your order ${order.orderNumber} has been cancelled.`,
          ...(order.trackingUrl ? ["", `Order details: ${order.trackingUrl}`] : []),
          "",
          `If you paid online, a refund of ${total(order)} is on its way and usually`,
          "appears within a few business days.",
          "",
          "If this is unexpected, please call the store.",
        ].join("\n"),
      };

    case "order_refunded":
      return {
        subject: `Refund issued for order ${order.orderNumber}`,
        text: [
          `Hi ${order.customerName}, we've issued a refund of ${refundAmount(event)} on your order ${order.orderNumber}.`,
          "",
          event.refund?.partial
            ? `This is a partial refund — the rest of your order is unchanged.`
            : `This refunds your order in full.`,
          "",
          "Refunds usually appear on your statement within a few business days.",
          ...(order.trackingUrl ? ["", `Order details: ${order.trackingUrl}`] : []),
          "",
          "Questions? Just call the store.",
        ].join("\n"),
      };
  }
}

/**
 * The customer's text message. GSM-7 ASCII only — an em-dash or curly quote
 * silently switches the whole message to UCS-2 and 70-character segments,
 * tripling the bill — and capped to one segment, dropping the tracking link
 * before ever truncating the message itself.
 */
export function renderCustomerSms(event: NotificationEvent): string | null {
  const { order } = event;
  const when = `${formatStoreDate(order.pickupDate, "short")} ${formatPickupTime(order.pickupTime)}`;
  const where = order.pickupLocationName ? ` at ${order.pickupLocationName}` : "";

  let body: string;
  switch (event.kind) {
    case "order_ready":
      body = `Harina: order ${order.orderNumber} is ready for pickup ${when}${where}. Bring your pickup pass.`;
      break;
    case "order_canceled":
      body = `Harina: order ${order.orderNumber} was cancelled. Any payment is being refunded. Questions? Call the store.`;
      break;
    case "order_refunded":
      body = `Harina: a refund of ${refundAmount(event)} was issued on order ${order.orderNumber}. It usually appears in a few days.`;
      break;
    default:
      return null;
  }

  // Strip anything outside printable ASCII so a fancy location name can't
  // silently switch the encoding.
  body = body.replace(/[^\x20-\x7E]/g, "");

  if (order.trackingUrl) {
    const withLink = `${body} ${order.trackingUrl}`;
    if (withLink.length <= SMS_SEGMENT_LIMIT) return withLink;
  }
  return body.length <= SMS_SEGMENT_LIMIT ? body : body.slice(0, SMS_SEGMENT_LIMIT);
}

/* -------------------------------------------------------------------------- */
/* Chat and board integrations                                                */
/* -------------------------------------------------------------------------- */

/** Colours are per-event so an order stands out in a busy channel. */
const DISCORD_COLOR: Record<NotificationEvent["kind"], number> = {
  order_paid: 0x2563eb,
  order_ready: 0x15803d,
  order_canceled: 0xb42318,
  order_refunded: 0xb45309,
};

export function renderDiscord(event: NotificationEvent): unknown {
  const { order } = event;
  const { subject } = renderStoreEmail(event);

  return {
    embeds: [
      {
        title: subject,
        color: DISCORD_COLOR[event.kind],
        fields: [
          { name: "Pickup", value: pickupLine(order), inline: true },
          { name: "Total", value: total(order), inline: true },
          { name: "Customer", value: `${order.customerName}\n${order.customerPhone}` },
          { name: "Items", value: itemLines(order).join("\n") || "—" },
          ...(order.note ? [{ name: "Note", value: order.note }] : []),
        ],
      },
    ],
  };
}

export function renderSlack(event: NotificationEvent): unknown {
  const { order } = event;
  const { subject } = renderStoreEmail(event);

  return {
    text: subject,
    blocks: [
      { type: "header", text: { type: "plain_text", text: subject } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Pickup*\n${pickupLine(order)}` },
          { type: "mrkdwn", text: `*Total*\n${total(order)}` },
          { type: "mrkdwn", text: `*Customer*\n${order.customerName}` },
          { type: "mrkdwn", text: `*Phone*\n${order.customerPhone}` },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Items*\n${itemLines(order).join("\n") || "—"}` },
      },
    ],
  };
}

export function renderTrello(event: NotificationEvent): { name: string; desc: string } {
  const { order } = event;
  return {
    name: `${order.orderNumber} — ${pickupLine(order)} — ${order.customerName}`,
    desc: renderStoreEmail(event).text,
  };
}

/** Payload for the store's own generic webhook. Stable shape — treat as an API. */
export function renderWebhook(event: NotificationEvent): unknown {
  return {
    event: event.kind,
    order: {
      number: event.order.orderNumber,
      pickupDate: event.order.pickupDate,
      pickupTime: event.order.pickupTime,
      customer: {
        name: event.order.customerName,
        email: event.order.customerEmail,
        phone: event.order.customerPhone,
      },
      items: event.order.items,
      totalCents: event.order.totalCents,
      currency: event.order.currency,
      note: event.order.note,
    },
  };
}
