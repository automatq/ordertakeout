import type { Instrumentation } from "next";

/**
 * Server-side error monitoring (Sentry, errors-only).
 *
 * `register()` runs once per Next server instance; `onRequestError` receives
 * every error that escapes a route handler, server action, or RSC render —
 * the webhook and cron endpoints included. Tracing stays off
 * (`tracesSampleRate: 0`): this exists to catch failures in a system that
 * moves money, not to profile it. With SENTRY_DSN unset everything here
 * no-ops, so local development and the demo need no Sentry account.
 *
 * Deliberately not wrapped in `withSentryConfig`: the file conventions are
 * framework-native, and skipping the build wrapper keeps `next build` (Next 16
 * + cacheComponents) unmodified. The cost is un-uploaded client source maps;
 * server stacks — the ones that matter for payments — are readable as-is.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0,
  });
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  await Sentry.captureRequestError(error, request, context);
};
