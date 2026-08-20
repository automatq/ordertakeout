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
    <main className="shell-tight flex flex-col gap-8 py-8 sm:py-12 lg:py-16">
      <nav aria-label="Breadcrumb">
        <Link
          href="/"
          className="text-ink-muted hover:text-brand inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-sm transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Home
        </Link>
      </nav>

      <header className="bg-brand text-brand-ink shadow-raised relative isolate overflow-hidden rounded-[2rem] px-6 py-9 sm:rounded-[2.5rem] sm:px-10 sm:py-12">
        <span
          aria-hidden
          className="bg-accent/30 absolute -top-16 -right-10 -z-10 size-56 rounded-full blur-2xl"
        />
        <span
          aria-hidden
          className="bg-brand-hover/60 absolute -bottom-24 left-1/3 -z-10 size-64 rounded-full blur-3xl"
        />
        <p className="bg-accent text-ink mb-4 inline-flex rounded-full px-4 py-2 text-xs font-semibold tracking-[0.14em] uppercase">
          Track your order
        </p>
        <h1 className="font-display text-display-lg max-w-2xl font-normal uppercase">
          Where&rsquo;s my order?
        </h1>
        <p className="text-brand-ink/85 mt-3 max-w-2xl text-base leading-relaxed sm:text-lg">
          Enter your order number and the email you ordered with, and we&rsquo;ll take you
          straight to it.
        </p>
      </header>

      <div className="mx-auto w-full max-w-2xl">
        <OrderLookupForm />
      </div>

      <div className="bg-secondary text-secondary-ink mx-auto flex w-full max-w-2xl flex-col gap-2 rounded-[1.5rem] px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>Lost your order number? We&rsquo;ll help you find it.</p>
        <a
          href={STORE_INFO.phoneHref}
          className="border-secondary-ink/35 hover:bg-secondary-ink/10 inline-flex min-h-11 items-center justify-center rounded-full border px-5 font-semibold transition-colors"
        >
          Call {STORE_INFO.phone}
        </a>
      </div>
    </main>
  );
}
