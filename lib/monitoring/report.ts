import "server-only";

import * as Sentry from "@sentry/nextjs";

/**
 * Error reporting for caught-and-handled failures.
 *
 * `instrumentation.ts` captures errors that *escape* a request, but this
 * codebase deliberately swallows most operational failures (a refund that needs
 * manual reconciliation, a Square call that failed after payment) and keeps
 * serving. Those paths previously wrote to Vercel logs nobody watches; now they
 * also reach Sentry when SENTRY_DSN is set. The console line always happens, so
 * local development and `vercel logs` keep working unchanged, and this function
 * never throws — error reporting must not create errors.
 *
 * `scope` is a short stable slug (it becomes a Sentry tag for grouping);
 * `message` says what was being attempted; `cause` is the caught value when
 * there is one.
 */
export function reportError(
  scope: string,
  message: string,
  cause?: unknown,
  extra?: Record<string, unknown>,
): void {
  const label = `[${scope}] ${message}`;
  if (cause !== undefined) console.error(`${label}:`, cause);
  else console.error(label);

  if (!process.env.SENTRY_DSN) return;
  try {
    if (cause !== undefined) {
      Sentry.captureException(cause, { tags: { scope }, extra: { message, ...extra } });
    } else {
      Sentry.captureMessage(label, { level: "error", tags: { scope }, extra });
    }
  } catch {
    // Reporting is best-effort by contract.
  }
}
