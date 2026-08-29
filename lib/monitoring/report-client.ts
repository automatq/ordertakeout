/**
 * Error reporting for client error boundaries.
 *
 * Mirrors lib/monitoring/report.ts for the browser: always logs to the
 * console, and forwards to Sentry only when NEXT_PUBLIC_SENTRY_DSN was set at
 * build time. The dynamic import keeps the SDK out of the customer bundle when
 * monitoring is off (same trade as instrumentation-client.ts).
 */
export function reportBoundaryError(error: Error & { digest?: string }): void {
  console.error(error);
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  void import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.captureException(error);
    })
    .catch(() => {
      // Reporting is best-effort; a blocked SDK fetch must not cascade.
    });
}
