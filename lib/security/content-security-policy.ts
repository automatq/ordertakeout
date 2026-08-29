import { PRODUCT_IMAGE_CSP_SOURCES } from "../catalog/image-policy";

export type SquareWebPaymentsEnvironment = "sandbox" | "production";

const SQUARE_WEB_PAYMENTS = {
  sandbox: {
    sdk: "https://sandbox.web.squarecdn.com",
    payment: "https://pci-connect.squareupsandbox.com",
  },
  production: {
    sdk: "https://web.squarecdn.com",
    payment: "https://pci-connect.squareup.com",
  },
} as const;

const SQUARE_TELEMETRY = "https://o160250.ingest.sentry.io";

/**
 * Digital-wallet origins for the Square Web Payments SDK. Google Pay loads its
 * button and sheet from pay.google.com; Cash App Pay loads its kit and talks to
 * its API. Apple Pay is a native sheet and needs nothing. Verify against
 * Square's current Web Payments CSP documentation on any SDK upgrade.
 */
const WALLET_SCRIPT_SOURCES = ["https://pay.google.com", "https://kit.cash.app"] as const;
const WALLET_CONNECT_SOURCES = [
  "https://pay.google.com",
  "https://google.com/pay",
  "https://api.cash.app",
] as const;
const WALLET_FRAME_SOURCES = ["https://pay.google.com"] as const;
const SQUARE_FONT_SOURCES = [
  "https://square-fonts-production-f.squarecdn.com",
  "https://d1g145x70srn7h.cloudfront.net",
] as const;

/**
 * Build the application CSP for the configured Square environment.
 *
 * The Square SDK chooses its script from the public application-id prefix, so
 * CSP must follow NEXT_PUBLIC_SQUARE_ENVIRONMENT rather than NODE_ENV. A Vercel
 * production build can intentionally be connected to Square Sandbox.
 */
export function buildContentSecurityPolicy({
  production,
  squareEnvironment,
  sentryIngestOrigin,
}: {
  production: boolean;
  squareEnvironment: SquareWebPaymentsEnvironment;
  /**
   * Origin of this app's own Sentry browser reporting (derived from
   * NEXT_PUBLIC_SENTRY_DSN), distinct from SQUARE_TELEMETRY which is the Square
   * SDK's built-in Sentry. Null when browser monitoring is not configured.
   */
  sentryIngestOrigin?: string | null;
}): string {
  const square = SQUARE_WEB_PAYMENTS[squareEnvironment];
  const connect = [square.sdk, square.payment, SQUARE_TELEMETRY, ...WALLET_CONNECT_SOURCES];
  if (sentryIngestOrigin) connect.push(sentryIngestOrigin);

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    /* 'wasm-unsafe-eval' is required for the staff QR scanner's WASM decoder,
       which stands in for BarcodeDetector on browsers that don't ship it (all
       of WebKit, so every iPad in the kitchen). It is far narrower than
       'unsafe-eval': it permits WebAssembly compilation and nothing else, and
       without it Chrome blocks the decoder outright in production, where
       'unsafe-eval' is absent. */
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${production ? "" : " 'unsafe-eval'"} ${square.sdk} ${WALLET_SCRIPT_SOURCES.join(" ")}`,
    `style-src 'self' 'unsafe-inline' ${square.sdk}`,
    `img-src 'self' data: blob: ${PRODUCT_IMAGE_CSP_SOURCES.join(" ")}`,
    `font-src 'self' data: ${SQUARE_FONT_SOURCES.join(" ")}`,
    `connect-src 'self' ${connect.join(" ")}`,
    `frame-src 'self' ${square.sdk} ${WALLET_FRAME_SOURCES.join(" ")}`,
    ...(production ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/**
 * The origin a Sentry DSN reports to, for the connect-src allowlist.
 * A malformed DSN yields null rather than a broken CSP entry.
 */
export function sentryIngestOriginFromDsn(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    return new URL(dsn).origin;
  } catch {
    return null;
  }
}
