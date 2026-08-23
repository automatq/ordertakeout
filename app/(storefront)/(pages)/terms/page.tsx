import type { Metadata } from "next";
import Link from "next/link";

import { STORE_INFO } from "@/lib/store";

export const metadata: Metadata = {
  title: "Terms of service",
  description: `The terms that apply when you pre-order from ${STORE_INFO.name} for pickup.`,
};

export default function TermsPage() {
  return (
    <>
      <h1>Terms of service</h1>
      <p>
        These terms apply when you order from <strong>{STORE_INFO.name}</strong>{" "}
        ({STORE_INFO.street}, {STORE_INFO.city}) through this website. Placing an order means
        you accept them. Last updated August 23, 2026.
      </p>

      <h2>Ordering and payment</h2>
      <ul>
        <li>
          Every order is a <strong>pre-order for pickup</strong> at the location, date and time
          you choose at checkout. Each product shows its own notice period and order cutoff
          before you pay.
        </li>
        <li>
          Prices are in Canadian dollars. Applicable taxes, and any tip you choose to add, are
          shown before payment and charged together when you place the order.
        </li>
        <li>
          Your order is confirmed when payment succeeds — you&apos;ll see a confirmation page
          and receive a confirmation email with your order number and a link to track it.
        </li>
        <li>
          Pickup dates and times are subject to availability; the store may pause online
          ordering or mark items sold out for a given day.
        </li>
      </ul>

      <h2>Pickup</h2>
      <ul>
        <li>
          Bring your order number or the pickup pass from your confirmation link. Staff verify
          it at the counter.
        </li>
        <li>
          Our goods are baked fresh and are perishable. If you can&apos;t make your pickup
          time, call us as soon as you can at{" "}
          <a href={STORE_INFO.phoneHref}>{STORE_INFO.phone}</a> — we&apos;ll do our best, but we
          can&apos;t guarantee holding an unclaimed order beyond its pickup day, and unclaimed
          orders are not automatically refunded.
        </li>
      </ul>

      <h2>Cancellations and refunds</h2>
      <p>
        You can cancel online until your order&apos;s production cutoff; after that the kitchen
        has started. The details, including how tips and rewards are handled, are in our{" "}
        <Link href="/refund-policy">refund policy</Link>.
      </p>

      <h2>Rewards</h2>
      <ul>
        <li>
          The rewards program is optional and tied to an account. Points accrue on eligible
          purchase amounts (tips never earn points) and are reversed if an order is cancelled
          or refunded.
        </li>
        <li>
          Points have no cash value, can&apos;t be transferred or sold, and the program may be
          changed or ended at any time; earned balances will be honoured or wound down fairly.
        </li>
      </ul>

      <h2>Allergens</h2>
      <p>
        All items are prepared in a shared kitchen that handles wheat, dairy, eggs, nuts,
        peanuts, soy and sesame. Ingredient information on this site is a guide, not a
        guarantee — if you have an allergy, always confirm with the store before ordering.
      </p>

      <h2>The legal part</h2>
      <p>
        We&apos;re a bakery, not a platform: our responsibility for any order is limited to the
        amount you paid for it, except where the law says otherwise (nothing here limits your
        rights under Ontario consumer-protection law). These terms are governed by the laws of
        Ontario and Canada. Questions? Email{" "}
        <a href={`mailto:${STORE_INFO.email}`}>{STORE_INFO.email}</a>. See also our{" "}
        <Link href="/privacy">privacy policy</Link>.
      </p>
    </>
  );
}
