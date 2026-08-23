/**
 * Browser-side error monitoring (Sentry, errors-only).
 *
 * NEXT_PUBLIC_SENTRY_DSN is inlined at build time; when it's unset the SDK is
 * never fetched — the dynamic import keeps ~90 KB of monitoring code out of
 * every customer's checkout when monitoring isn't configured. Errors thrown
 * before the async chunk resolves are missed, which is an acceptable trade for
 * a bundle that stays lean by default.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn,
      environment: process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT ?? "sandbox",
      tracesSampleRate: 0,
    });
  });
}
