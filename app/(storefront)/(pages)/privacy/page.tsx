import type { Metadata } from "next";
import Link from "next/link";

import { STORE_INFO } from "@/lib/store";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: `How ${STORE_INFO.name} collects, uses and protects your information when you pre-order for pickup.`,
};

/**
 * Every claim on this page describes what the code actually does — checkout
 * fields, Square-hosted card entry, the notification providers, the retention
 * anonymizer in lib/maintenance.ts, and the SMS consent flow. If behavior
 * changes, this page must change in the same PR.
 */
export default function PrivacyPolicyPage() {
  return (
    <>
      <h1>Privacy policy</h1>
      <p>
        <strong>{STORE_INFO.name}</strong> ({STORE_INFO.street}, {STORE_INFO.city}) runs this
        website so you can pre-order baked goods for pickup. This page explains what
        information we collect, why, and what happens to it. Last updated August 23, 2026.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Order details.</strong> Your name, email address, phone number, the items you
          ordered, your pickup date, time and location, and any note you add. We need these to
          prepare your order and to reach you about it.
        </li>
        <li>
          <strong>Payment references — never card numbers.</strong> Card and digital-wallet
          entry happens inside Square&apos;s secure payment form; your card number goes directly
          to Square and never touches our servers. We keep only Square&apos;s order, payment and
          refund reference IDs and the amounts charged or refunded.
        </li>
        <li>
          <strong>Account details, only if you create one.</strong> Accounts are optional. An
          account stores your email, your order history and your rewards balance, and uses a
          signed session cookie to keep you signed in. You can order without one.
        </li>
        <li>
          <strong>Your cart stays in your browser.</strong> Items you add are stored on your own
          device and are only sent to us when you place the order.
        </li>
      </ul>

      <h2>Text messages</h2>
      <p>
        We only text you if you tick the SMS box at checkout — it is unchecked by default, and
        we record when you gave consent. Messages are about your order only (for example,
        &ldquo;your order is ready&rdquo;); we never send marketing texts. Reply STOP at any
        time to opt out.
      </p>

      <h2>Who we share it with</h2>
      <p>
        We never sell your information, and we use no advertising or analytics trackers. Your
        details are shared only with the services that make the order work:
      </p>
      <ul>
        <li><strong>Square</strong> processes payments and refunds.</li>
        <li><strong>Resend</strong> delivers order emails.</li>
        <li><strong>Twilio</strong> delivers order texts, when you have opted in.</li>
        <li>
          <strong>Our hosting, database and error-monitoring providers</strong> run the site and
          alert us to technical faults.
        </li>
        <li>
          <strong>The bakery&apos;s own order tools.</strong> New-order alerts carrying your
          order details go to the store&apos;s staff channels so the kitchen can start work.
        </li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        Once an order is completed or cancelled, your name, email, phone number and notes are
        automatically removed from it on a rolling schedule; the order&apos;s totals and
        references remain for bookkeeping. Delivery logs for notifications are pruned after 90
        days.
      </p>

      <h2>Your choices</h2>
      <p>
        You can ask us to access, correct or delete the personal information we hold about you
        — email <a href={`mailto:${STORE_INFO.email}`}>{STORE_INFO.email}</a> or call{" "}
        <a href={STORE_INFO.phoneHref}>{STORE_INFO.phone}</a>. We handle personal information
        in line with Canadian privacy law (PIPEDA). See also our{" "}
        <Link href="/terms">terms of service</Link> and{" "}
        <Link href="/refund-policy">refund policy</Link>.
      </p>
    </>
  );
}
