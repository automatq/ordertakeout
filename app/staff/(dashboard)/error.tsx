"use client";

import { useEffect } from "react";

import { AlertIcon } from "@/components/ui/icons";
import { reportBoundaryError } from "@/lib/monitoring/report-client";

/**
 * Staff error boundary.
 *
 * Different audience, different content from the storefront's: staff can act on
 * a digest, they need to know the orders themselves are safe, and the fallback
 * is the printed prep sheet rather than a phone call.
 */
export default function StaffError({
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
    <div className="shell-narrow flex flex-col items-start gap-4 py-16">
      <span
        aria-hidden
        className="bg-danger-soft text-danger flex h-12 w-12 items-center justify-center rounded-full"
      >
        <AlertIcon className="h-6 w-6" />
      </span>

      <h1 className="font-display text-ink text-display-md font-normal uppercase">
        This screen failed to load
      </h1>
      <p className="text-ink-muted text-pretty">
        Orders are unaffected &mdash; nothing has been lost. Retry the screen; if it keeps
        failing, work from the last printed prep sheet and let the developer know the
        reference below.
      </p>

      <div className="flex flex-wrap gap-3 pt-1">
        <button type="button" onClick={() => retry()} className="btn btn-primary">
          Retry
        </button>
        <a href="/staff" className="btn btn-secondary">
          Back to orders
        </a>
      </div>

      {error.digest ? (
        <p className="text-ink-subtle font-mono text-xs">Reference: {error.digest}</p>
      ) : null}
    </div>
  );
}
