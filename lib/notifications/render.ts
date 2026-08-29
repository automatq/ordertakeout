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

    case "order_reminder":
      return {
        subject: `Pickup today — order ${order.orderNumber}`,
        text: [
          `Hi ${order.customerName}, your order is being picked up today.`,
          "",
          `Order:  ${order.orderNumber}`,
          `Pickup: ${pickupLine(order)}`,
          "",
          "Items:",
          ...itemLines(order).map((line) => `  ${line}`),
          "",
          "Bring your order number or the pickup pass on your order page.",
          ...(order.trackingUrl ? ["", `Your order & pickup pass: ${order.trackingUrl}`] : []),
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

  /* Two lengths per message. `full` is what we'd like to say; `essential` is
     what still answers the customer's question once the link has taken its
     share of the segment. */
  let full: string;
  let essential: string;
  switch (event.kind) {
    case "order_paid":
      full = `Harina: order ${order.orderNumber} is confirmed for pickup ${when}${where}. Details and pickup pass:`;
      essential = `Harina: order ${order.orderNumber} confirmed, pickup ${when}.`;
      break;
    case "order_ready":
      full = `Harina: order ${order.orderNumber} is ready for pickup ${when}${where}. Bring your pickup pass.`;
      essential = `Harina: order ${order.orderNumber} is ready, pickup ${when}.`;
      break;
    case "order_canceled":
      full = `Harina: order ${order.orderNumber} was cancelled. Any payment is being refunded. Questions? Call the store.`;
      essential = `Harina: order ${order.orderNumber} was cancelled and refunded.`;
      break;
    case "order_refunded":
      full = `Harina: a refund of ${refundAmount(event)} was issued on order ${order.orderNumber}. It usually appears in a few days.`;
      essential = `Harina: refund of ${refundAmount(event)} issued on order ${order.orderNumber}.`;
      break;
    case "order_reminder":
      full = `Harina: your pickup is today ${formatPickupTime(order.pickupTime)}${where}, order ${order.orderNumber}. Bring your pickup pass.`;
      essential = `Harina: pickup today ${formatPickupTime(order.pickupTime)}, order ${order.orderNumber}.`;
      break;
    default:
      return null;
  }

  return assembleCustomerSms(full, essential, order.trackingShortUrl ?? order.trackingUrl ?? null);
}

/**
 * Fit a message and its link into one segment, sacrificing prose before the link.
 *
 * This used to work the other way round: the URL was appended only if the whole
 * message still fit, so a long branch name silently cost the customer the only
 * way to open their pickup pass. A full tracking URL is ~95 characters against a
 * 160-character segment, so with any real message that test essentially never
 * passed — every text went out linkless. Now the link reserves its space first.
 */
function assembleCustomerSms(full: string, essential: string, link: string | null): string {
  // Strip anything outside printable ASCII so a fancy location name can't
  // silently switch the encoding to UCS-2 and halve the segment.
  const clean = (value: string) => value.replace(/[^\x20-\x7E]/g, "");
  const fullBody = clean(full);
  const essentialBody = clean(essential);

  if (!link) {
    if (fullBody.length <= SMS_SEGMENT_LIMIT) return fullBody;
    return essentialBody.length <= SMS_SEGMENT_LIMIT
      ? essentialBody
      : essentialBody.slice(0, SMS_SEGMENT_LIMIT);
  }

  const budget = SMS_SEGMENT_LIMIT - link.length - 1;
  if (fullBody.length <= budget) return `${fullBody} ${link}`;
  if (essentialBody.length <= budget) return `${essentialBody} ${link}`;
  /* Never truncate the URL itself — half a link is worse than a terse message,
     because it looks clickable and isn't. */
  return budget > 0 ? `${essentialBody.slice(0, budget).trimEnd()} ${link}` : link;
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
  // Reminders are customer-channel-only and never reach Discord; the entry
  // exists so this record stays exhaustive over the kind union.
  order_reminder: 0x2563eb,
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
