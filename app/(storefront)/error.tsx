"use client";

import { useEffect } from "react";

import { AlertIcon } from "@/components/ui/icons";
import { reportBoundaryError } from "@/lib/monitoring/report-client";
import { STORE_INFO } from "@/lib/store";

/**
 * Storefront error boundary.
 *
 * Anything thrown while rendering a customer page used to fall through to
 * Next's own error screen — outside the brand, with no phone number on it. A
 * customer who hits this is mid-purchase, so the two things it has to give them
 * are a retry and a way to order by phone instead.
 *
 * Next 16 passes `retry`, not `reset`.
 */
export default function StorefrontError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    reportBoundaryError(error);
  }, [error]);

  return (
    <main className="bg-brand px-6 py-section">
      <div className="bg-surface shadow-raised mx-auto flex max-w-2xl flex-col items-center gap-6 rounded-[2.5rem] p-8 text-center sm:p-12">
      <span
        aria-hidden
        className="bg-accent-soft text-brand flex h-20 w-20 items-center justify-center rounded-full"
      >
        <AlertIcon className="h-10 w-10" />
      </span>

      <h1 className="font-display text-brand text-display-lg font-normal uppercase">
        Something went wrong
      </h1>
      <p className="text-ink-muted max-w-md text-lg text-pretty">
        We hit a problem loading this page. Nothing has been charged. Try again, or give
        us a call and we&rsquo;ll take your order over the phone.
      </p>

      <div className="flex flex-wrap justify-center gap-3 pt-2">
        <button type="button" onClick={() => retry()} className="btn btn-primary">
          Try again
        </button>
        <a href={STORE_INFO.phoneHref} className="btn btn-secondary">
          Call {STORE_INFO.phone}
        </a>
      </div>

      {/* The digest is what maps this screen to a server log line. Useless to
          the customer on its own, invaluable when they read it out to staff. */}
      {error.digest ? (
        <p className="text-ink-subtle text-xs">Reference: {error.digest}</p>
      ) : null}
      </div>
    </main>
  );
}
