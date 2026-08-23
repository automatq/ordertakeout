import type { Metadata } from "next";
import Link from "next/link";

import { STORE_INFO } from "@/lib/store";

export const metadata: Metadata = {
  title: "Refund policy",
  description: `When and how ${STORE_INFO.name} orders can be cancelled and refunded.`,
};

/**
 * Mirrors lib/orders/cancellation.ts (the online cutoff) and the refund ledger
 * (full refunds include the tip; rewards reverse). Keep them in sync.
 */
export default function RefundPolicyPage() {
  return (
    <>
      <h1>Refund policy</h1>
      <p>
        Everything is baked to order, so refunds follow the kitchen&apos;s clock: easy before
        we start baking, at the store&apos;s discretion after. Last updated August 23, 2026.
      </p>

      <h2>Cancelling before the cutoff</h2>
      <ul>
        <li>
          You can cancel online from your order&apos;s tracking page any time{" "}
          <strong>until the order&apos;s production cutoff</strong> — each product&apos;s notice
          period before your pickup date, at the store&apos;s local time. If your order has
          several items, the earliest cutoff applies. Your tracking page shows the exact
          deadline.
        </li>
        <li>
          Cancelling before the cutoff refunds the <strong>full amount you were charged,
          including any tip</strong>, to your original payment method.
        </li>
      </ul>

      <h2>After the cutoff</h2>
      <ul>
        <li>
          Once the cutoff passes, the kitchen has started your order and online cancellation
          closes. Call us at <a href={STORE_INFO.phoneHref}>{STORE_INFO.phone}</a> — refunds
          after the cutoff, and for unclaimed pickups, are at the store&apos;s discretion.
        </li>
        <li>
          If something isn&apos;t right with an order you received, tell us. The store can
          issue a full or partial refund to your original payment method, including after
          pickup.
        </li>
      </ul>

      <h2>How refunds arrive</h2>
      <ul>
        <li>
          Refunds are processed through Square back to the card or wallet you paid with. Square
          releases them promptly; banks typically post the money within 5–10 business days.
        </li>
        <li>
          If your order earned rewards points, a refund reverses them.
        </li>
      </ul>

      <p>
        Questions about a refund? Email{" "}
        <a href={`mailto:${STORE_INFO.email}`}>{STORE_INFO.email}</a> with your order number.
        See also our <Link href="/terms">terms of service</Link> and{" "}
        <Link href="/privacy">privacy policy</Link>.
      </p>
    </>
  );
}
