import Link from "next/link";

import { OrderLookupForm } from "@/components/orders/order-lookup-form";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { STORE_INFO } from "@/lib/store";

export const metadata = {
  title: "Track your order",
  description: "Look up a Harina Bakeshoppe pre-order by order number and email address.",
};

/**
 * Order lookup.
 *
 * Sits at `/orders`, above `/orders/[orderNumber]`, so the two are one idea:
 * find an order, then view it. Linked from the header and footer, because until
 * now the only route to an order was the URL in the confirmation email.
 */
export default function OrderLookupPage() {
  return (
    <main className="shell-narrow flex flex-col gap-8 py-12 sm:py-16">
      <nav aria-label="Breadcrumb">
        <Link
          href="/"
          className="text-ink-muted hover:text-brand inline-flex items-center gap-2 text-sm transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Home
        </Link>
      </nav>

      <header className="flex flex-col gap-3">
        <p className="eyebrow">Track your order</p>
        <h1 className="font-display text-ink text-display-lg font-normal uppercase">
          Where&rsquo;s my order?
        </h1>
        <p className="text-ink-muted text-lg text-pretty">
          Enter your order number and the email you ordered with, and we&rsquo;ll take you
          straight to it.
        </p>
      </header>

      <OrderLookupForm />

      <p className="text-ink-muted text-sm">
        Lost your order number? Call us on{" "}
        <a href={STORE_INFO.phoneHref} className="link">
          {STORE_INFO.phone}
        </a>{" "}
        and we&rsquo;ll find it for you.
      </p>
    </main>
  );
}
