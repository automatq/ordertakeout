import { describe, expect, it } from "vitest";

import {
  SMS_SEGMENT_LIMIT,
  renderCustomerEmail,
  renderCustomerSms,
  renderDiscord,
  renderSlack,
  renderStoreEmail,
  renderStoreSms,
  renderTrello,
  renderWebhook,
} from "./render";
import type { NotificationEvent, OrderNotification } from "./types";

const ORDER: OrderNotification = {
  orderId: "11111111-1111-4111-8111-111111111111",
  orderNumber: "PT-K7M2QX",
  customerName: "Maria Santos",
  customerEmail: "maria@example.com",
  customerPhone: "+15551234567",
  pickupDate: "2026-03-05",
  pickupTime: "16:00",
  totalCents: 7000,
  currency: "USD",
  items: [
    { quantity: 2, name: "Ensaymada Party Tray — 25 pcs Ube" },
    { quantity: 1, name: "Hopia Ube / Hopia Baboy — 60 pcs" },
  ],
  note: null,
};

const paid: NotificationEvent = { kind: "order_paid", order: ORDER };
const ready: NotificationEvent = { kind: "order_ready", order: ORDER };
const canceled: NotificationEvent = { kind: "order_canceled", order: ORDER };

describe("store email", () => {
  it("leads with what staff need: order, pickup, contact, items, total", () => {
    const { subject, text } = renderStoreEmail(paid);
    expect(subject).toContain("PT-K7M2QX");
    expect(subject).toContain("Mar 5");
    expect(text).toContain("Thu, Mar 5 at 4:00 PM");
    expect(text).toContain("Maria Santos");
    expect(text).toContain("+15551234567");
    expect(text).toContain("2x Ensaymada Party Tray — 25 pcs Ube");
    expect(text).toContain("$70.00");
    expect(text).toContain("PAID ONLINE");
  });

  it("includes a customer note when there is one", () => {
    const { text } = renderStoreEmail({ ...paid, order: { ...ORDER, note: "No nuts please" } });
    expect(text).toContain("Note: No nuts please");
  });

  it("marks cancellations rather than reusing the new-order wording", () => {
    expect(renderStoreEmail(canceled).subject).toContain("cancelled");
    expect(renderStoreEmail(canceled).text).not.toContain("PAID ONLINE");
  });
});

describe("store SMS", () => {
  it("fits in one 160-character segment", () => {
    expect(renderStoreSms(paid).length).toBeLessThanOrEqual(SMS_SEGMENT_LIMIT);
  });

  it("still fits with many long item names, and says how many were dropped", () => {
    // Cost control: a message that silently spills into three segments triples
    // the store's bill for every order.
    const many: NotificationEvent = {
      kind: "order_paid",
      order: {
        ...ORDER,
        items: Array.from({ length: 12 }, (_, i) => ({
          quantity: i + 1,
          name: `Ensaymada Party Tray — Extremely Long Variant Name Number ${i}`,
        })),
      },
    };
    const message = renderStoreSms(many);
    expect(message.length).toBeLessThanOrEqual(SMS_SEGMENT_LIMIT);
    expect(message).toMatch(/\+\d+ more/);
  });

  it("always keeps the essentials even when nothing else fits", () => {
    const message = renderStoreSms(paid);
    expect(message).toContain("PT-K7M2QX");
    expect(message).toContain("4:00 PM");
    expect(message).toContain("$70.00");
  });

  it("labels the event type", () => {
    expect(renderStoreSms(paid)).toMatch(/^NEW ORDER/);
    expect(renderStoreSms(ready)).toMatch(/^READY/);
    expect(renderStoreSms(canceled)).toMatch(/^CANCELLED/);
  });

  it("handles an order with no items without producing a stray separator", () => {
    const empty = renderStoreSms({ kind: "order_paid", order: { ...ORDER, items: [] } });
    expect(empty).not.toMatch(/- $/);
    expect(empty.length).toBeLessThanOrEqual(SMS_SEGMENT_LIMIT);
  });
});

describe("customer email", () => {
  it("confirms a paid order with the pickup details", () => {
    const mail = renderCustomerEmail(paid);
    expect(mail?.subject).toContain("confirmed");
    expect(mail?.text).toContain("Thu, Mar 5 at 4:00 PM");
    expect(mail?.text).toContain("PT-K7M2QX");
  });

  it("tells the customer their order is ready", () => {
    expect(renderCustomerEmail(ready)?.subject).toContain("ready");
  });

  it("sets refund expectations on cancellation", () => {
    const mail = renderCustomerEmail(canceled);
    expect(mail?.text).toContain("refund");
    expect(mail?.text).toContain("$70.00");
  });

  it("never leaks the other customer's contact details into the body", () => {
    // Guards against copy-pasting the store template, which contains the phone
    // number and email of the buyer — fine for staff, wrong in a customer email.
    const mail = renderCustomerEmail(ready);
    expect(mail?.text).not.toContain(ORDER.customerPhone);
  });
});

describe("chat and board payloads", () => {
  it("builds a Discord embed with pickup, total and items", () => {
    const payload = renderDiscord(paid) as {
      embeds: { title: string; color: number; fields: { name: string; value: string }[] }[];
    };
    const embed = payload.embeds[0]!;
    expect(embed.title).toContain("PT-K7M2QX");
    expect(embed.fields.map((f) => f.name)).toEqual(
      expect.arrayContaining(["Pickup", "Total", "Customer", "Items"]),
    );
  });

  it("colours Discord embeds differently per event", () => {
    const colorOf = (event: NotificationEvent) =>
      (renderDiscord(event) as { embeds: { color: number }[] }).embeds[0]!.color;
    expect(new Set([colorOf(paid), colorOf(ready), colorOf(canceled)]).size).toBe(3);
  });

  it("builds Slack blocks with a fallback text for notifications", () => {
    const payload = renderSlack(paid) as { text: string; blocks: unknown[] };
    expect(payload.text).toContain("PT-K7M2QX");
    expect(payload.blocks.length).toBeGreaterThan(0);
  });

  it("names a Trello card so the board is scannable by pickup time", () => {
    const card = renderTrello(paid);
    expect(card.name).toBe("PT-K7M2QX — Thu, Mar 5 at 4:00 PM — Maria Santos");
    expect(card.desc).toContain("Items:");
  });

  it("emits a stable webhook shape", () => {
    // The store may wire this into anything, so treat it as a published API.
    expect(renderWebhook(paid)).toEqual({
      event: "order_paid",
      order: {
        number: "PT-K7M2QX",
        pickupDate: "2026-03-05",
        pickupTime: "16:00",
        customer: {
          name: "Maria Santos",
          email: "maria@example.com",
          phone: "+15551234567",
        },
        items: ORDER.items,
        totalCents: 7000,
        currency: "USD",
        note: null,
      },
    });
  });
});

describe("renderCustomerSms", () => {
  const base = {
    orderId: "o1",
    orderNumber: "PT-1001",
    customerName: "Maria",
    customerEmail: "m@example.com",
    customerPhone: "+14165550142",
    pickupDate: "2026-08-24" as const,
    pickupTime: "16:00" as const,
    pickupLocationName: "Wilson Ave",
    totalCents: 4500,
    currency: "CAD",
    items: [{ quantity: 1, name: "25 pcs Ube" }],
    note: null,
    trackingUrl: "https://harina.example/orders/PT-1001?key=abc123",
    customerSmsOptIn: true,
  };

  it("stays within one GSM-7 segment, link included when it fits", () => {
    const body = renderCustomerSms({ kind: "order_ready", order: base });
    expect(body).not.toBeNull();
    expect(body!.length).toBeLessThanOrEqual(SMS_SEGMENT_LIMIT);
    expect(body).toContain("PT-1001");
    expect(body).toContain("https://harina.example");
    // Printable ASCII only — anything else flips the whole message to UCS-2.
    expect(body).toMatch(/^[\x20-\x7E]*$/);
  });

  it("drops the link before ever truncating the message", () => {
    const body = renderCustomerSms({
      kind: "order_ready",
      order: {
        ...base,
        pickupLocationName: "The Extremely Long Location Name At The Far End Of Town Plaza",
        trackingUrl: `https://harina.example/orders/PT-1001?key=${"x".repeat(80)}`,
      },
    });
    expect(body).not.toBeNull();
    expect(body!.length).toBeLessThanOrEqual(SMS_SEGMENT_LIMIT);
    expect(body).not.toContain("https://");
  });

  it("strips non-ASCII from fancy location names", () => {
    const body = renderCustomerSms({
      kind: "order_ready",
      order: { ...base, pickupLocationName: "Café — Où", trackingUrl: null },
    });
    expect(body).toMatch(/^[\x20-\x7E]*$/);
  });

  it("returns null for kinds customers are not texted about", () => {
    expect(renderCustomerSms({ kind: "order_paid", order: base })).toBeNull();
  });
});
