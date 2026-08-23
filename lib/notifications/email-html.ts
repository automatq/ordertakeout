import { serverEnv } from "@/lib/env";
import { googleCalendarUrl } from "@/lib/orders/calendar-link";
import { formatPickupTime, formatStoreDate } from "@/lib/scheduling/time";
import { formatMoney } from "@/lib/square/money";
import { STORE_INFO } from "@/lib/store";

import type { NotificationEvent, OrderNotification } from "./types";

/**
 * Branded HTML for the customer emails — the most-seen brand surface after
 * checkout, previously plain text.
 *
 * Hand-rolled and dependency-free on purpose: table layout, every style
 * inline, because email clients ignore stylesheets and a template library
 * would drag its own color system past the token lint. The colors below are
 * LITERAL mirrors of the `@theme` tokens in app/globals.css (emails cannot
 * read CSS variables); a rebrand must update both — docs/THEMING.md says so.
 *
 * Every interpolation goes through escapeHtml — the customer's own name is
 * attacker-controlled input on this surface. The plain-text rendering stays
 * alongside as the fallback part of the same message.
 */

export const EMAIL_COLORS = {
  canvas: "#f5f1e9",
  surface: "#ffffff",
  ink: "#1a1a1a",
  inkMuted: "#5c5449",
  brand: "#ce3f23",
  brandDeep: "#a8321c",
  accent: "#ffc446",
} as const;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderCustomerEmailHtml(event: NotificationEvent): string | null {
  const { order } = event;
  switch (event.kind) {
    case "order_paid":
      return layout({
        preheader: `Order ${order.orderNumber} confirmed — pickup ${pickupLineText(order)}`,
        eyebrow: "Order confirmed",
        heading: `Thanks, ${order.customerName.split(" ")[0] ?? order.customerName}!`,
        intro: "Your order is confirmed and paid. Bring your order number (or the pickup pass on your order page) when you collect it.",
        order,
        cta: order.trackingUrl ? { href: order.trackingUrl, label: "View your order & pickup pass" } : null,
        showItems: true,
        showCalendar: true,
      });
    case "order_ready":
      return layout({
        preheader: `Order ${order.orderNumber} is ready for pickup`,
        eyebrow: "Ready for pickup",
        heading: "Your order is ready!",
        intro: "Come on by — we'll have it waiting at the counter. Show your pickup pass or read out your order number.",
        order,
        cta: order.trackingUrl ? { href: order.trackingUrl, label: "Show my pickup pass" } : null,
        showItems: false,
        showCalendar: false,
      });
    case "order_canceled":
      return layout({
        preheader: `Order ${order.orderNumber} was cancelled`,
        eyebrow: "Order cancelled",
        heading: "This order was cancelled",
        intro: `If you paid online, a refund of ${formatMoney(order.totalCents, order.currency)} is on its way and usually appears within a few business days. If this is unexpected, please call the store.`,
        order,
        cta: order.trackingUrl ? { href: order.trackingUrl, label: "Order details" } : null,
        showItems: false,
        showCalendar: false,
      });
    case "order_refunded": {
      const amount = formatMoney(event.refund?.amountCents ?? order.totalCents, order.currency);
      return layout({
        preheader: `Refund issued for order ${order.orderNumber}`,
        eyebrow: "Refund issued",
        heading: `We've refunded ${amount}`,
        intro: event.refund?.partial
          ? "This is a partial refund — the rest of your order is unchanged. Refunds usually appear on your statement within a few business days."
          : "This refunds your order in full. It usually appears on your statement within a few business days.",
        order,
        cta: order.trackingUrl ? { href: order.trackingUrl, label: "Order details" } : null,
        showItems: false,
        showCalendar: false,
      });
    }
    default:
      return null;
  }
}

function pickupLineText(order: OrderNotification): string {
  return `${formatStoreDate(order.pickupDate, "medium")} at ${formatPickupTime(order.pickupTime)}`;
}

function layout(input: {
  preheader: string;
  eyebrow: string;
  heading: string;
  intro: string;
  order: OrderNotification;
  cta: { href: string; label: string } | null;
  showItems: boolean;
  showCalendar: boolean;
}): string {
  const { order } = input;
  const c = EMAIL_COLORS;
  const publicUrl = serverEnv().STORE_PUBLIC_URL;

  const logo = publicUrl
    ? `<img src="${escapeHtml(`${publicUrl}/harina/logo.png`)}" alt="${escapeHtml(STORE_INFO.name)}" width="120" style="display:block;margin:0 auto;max-width:120px;height:auto;" />`
    : `<p style="margin:0;text-align:center;font-size:20px;font-weight:bold;color:${c.brandDeep};">${escapeHtml(STORE_INFO.name)}</p>`;

  const itemsTable = input.showItems && order.items.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse;">
        ${order.items
          .map(
            (item) => `<tr>
          <td style="padding:6px 0;color:${c.ink};font-size:14px;">${escapeHtml(`${item.quantity}× ${item.name}`)}</td>
        </tr>`,
          )
          .join("")}
        <tr>
          <td style="padding:10px 0 0;border-top:1px solid ${c.canvas};color:${c.ink};font-size:15px;font-weight:bold;">
            Paid ${escapeHtml(formatMoney(order.totalCents + (order.tipCents ?? 0), order.currency))}${(order.tipCents ?? 0) > 0 ? ` <span style="font-weight:normal;color:${c.inkMuted};">(includes ${escapeHtml(formatMoney(order.tipCents ?? 0, order.currency))} tip)</span>` : ""}
          </td>
        </tr>
      </table>`
    : "";

  const calendarUrl = input.showCalendar
    ? googleCalendarUrl({
        date: order.pickupDate,
        time: order.pickupTime,
        orderNumber: order.orderNumber,
        locationName: order.pickupLocationName ?? STORE_INFO.name,
        address: order.pickupLocationAddress ?? STORE_INFO.street,
        city: STORE_INFO.city,
        phone: STORE_INFO.phone,
      })
    : null;

  const cta = input.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px auto 0;"><tr>
        <td style="border-radius:999px;background:${c.brand};">
          <a href="${escapeHtml(input.cta.href)}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;border-radius:999px;">
            ${escapeHtml(input.cta.label)}
          </a>
        </td>
      </tr></table>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(input.preheader)}</title>
</head>
<body style="margin:0;padding:0;background:${c.canvas};">
  <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(input.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.canvas};padding:24px 0;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${c.surface};border-radius:24px;overflow:hidden;">
        <tr><td style="padding:28px 32px 8px;">${logo}</td></tr>
        <tr><td style="padding:8px 32px 0;text-align:center;">
          <p style="margin:0;color:${c.brand};font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">${escapeHtml(input.eyebrow)}</p>
          <h1 style="margin:8px 0 0;color:${c.ink};font-size:26px;line-height:1.2;">${escapeHtml(input.heading)}</h1>
          <p style="margin:12px 0 0;color:${c.inkMuted};font-size:15px;line-height:1.5;">${escapeHtml(input.intro)}</p>
          ${cta}
        </td></tr>
        <tr><td style="padding:24px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.canvas};border-radius:16px;">
            <tr><td style="padding:18px 20px;">
              <p style="margin:0;color:${c.inkMuted};font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">Order ${escapeHtml(order.orderNumber)}</p>
              <p style="margin:6px 0 0;color:${c.ink};font-size:16px;font-weight:bold;">${escapeHtml(pickupLineText(order))}</p>
              ${order.pickupLocationName ? `<p style="margin:4px 0 0;color:${c.ink};font-size:14px;">${escapeHtml(order.pickupLocationName)}</p>` : ""}
              ${order.pickupLocationAddress ? `<p style="margin:2px 0 0;color:${c.inkMuted};font-size:13px;">${escapeHtml(order.pickupLocationAddress)}</p>` : ""}
              ${calendarUrl ? `<p style="margin:10px 0 0;"><a href="${escapeHtml(calendarUrl)}" style="color:${c.brandDeep};font-size:13px;">Add to Google Calendar</a></p>` : ""}
              ${itemsTable}
              ${order.note && input.showItems ? `<p style="margin:8px 0 0;color:${c.inkMuted};font-size:13px;">Note: ${escapeHtml(order.note)}</p>` : ""}
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 32px 28px;text-align:center;">
          <p style="margin:0;color:${c.inkMuted};font-size:12px;line-height:1.6;">
            ${escapeHtml(STORE_INFO.name)} · ${escapeHtml(STORE_INFO.phone)}<br />
            Questions about this order? Just call the store.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
