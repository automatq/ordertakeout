import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ serverEnv: vi.fn() }));
vi.mock("@/lib/env", () => ({ serverEnv: mocks.serverEnv }));

import { escapeHtml, renderCustomerEmailHtml } from "./email-html";
import type { NotificationEvent } from "./types";

const ORDER: NotificationEvent["order"] = {
  orderId: "o1",
  orderNumber: "PT-1001",
  customerName: "Maria Santos",
  customerEmail: "maria@example.com",
  customerPhone: "+14165550142",
  pickupDate: "2026-08-24",
  pickupTime: "16:00",
  pickupLocationName: "Wilson Ave",
  pickupLocationAddress: "314 Wilson Avenue",
  totalCents: 4500,
  currency: "CAD",
  items: [{ quantity: 2, name: "25 pcs Ube" }],
  note: null,
  trackingUrl: "https://harina.example/orders/PT-1001?key=abc",
};

describe("customer HTML email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serverEnv.mockReturnValue({ STORE_PUBLIC_URL: "https://harina.example" });
  });

  it("renders confirmation with items, pickup block, CTA, and calendar link", () => {
    const html = renderCustomerEmailHtml({ kind: "order_paid", order: ORDER });
    expect(html).toContain("Order confirmed");
    expect(html).toContain("PT-1001");
    expect(html).toContain("2× 25 pcs Ube");
    expect(html).toContain("$45.00");
    expect(html).toContain("https://harina.example/orders/PT-1001?key=abc");
    expect(html).toContain("calendar.google.com");
    expect(html).toContain("https://harina.example/harina/logo.png");
  });

  it("escapes attacker-controlled interpolations everywhere", () => {
    const html = renderCustomerEmailHtml({
      kind: "order_paid",
      order: {
        ...ORDER,
        customerName: '<img src=x onerror=alert(1)>',
        items: [{ quantity: 1, name: '<script>bad()</script> tray' }],
        note: '"quoted" & <b>bold</b>',
      },
    });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("falls back to a text logo without STORE_PUBLIC_URL and skips the CTA without a tracking URL", () => {
    mocks.serverEnv.mockReturnValue({ STORE_PUBLIC_URL: undefined });
    const html = renderCustomerEmailHtml({
      kind: "order_ready",
      order: { ...ORDER, trackingUrl: null },
    });
    expect(html).not.toContain("/harina/logo.png");
    expect(html).toContain("ready");
    expect(html).not.toContain("Show my pickup pass");
  });

  it("mentions the partial amount on partial refunds", () => {
    const html = renderCustomerEmailHtml({
      kind: "order_refunded",
      order: ORDER,
      refund: { amountCents: 1500, partial: true },
    });
    expect(html).toContain("$15.00");
    expect(html).toContain("partial refund");
  });

  it("escapeHtml covers the five metacharacters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
