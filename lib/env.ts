import { z } from "zod";

/**
 * Environment configuration, validated at first use.
 *
 * Anything the browser needs (the Square Web Payments SDK needs the application
 * ID and location ID to render the card form) must be prefixed NEXT_PUBLIC_ and
 * referenced statically so Next.js can inline it at build time. Both of those
 * values are safe to expose; the access token and webhook signature key are not
 * and must never gain a NEXT_PUBLIC_ prefix.
 */

const isIanaTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

/**
 * An optional variable that may legitimately be present but blank.
 *
 * `.env.example` ships every optional channel as `KEY=""`, and a plain
 * `.optional()` rejects an empty string rather than treating it as unset — so
 * copying the example file and filling in only the channels you use would fail
 * validation and stop the app booting. Blank means "not configured".
 */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  /**
   * Every cutoff and pickup-slot calculation runs in this zone — never in the
   * browser's zone, or a customer travelling out of state could slip past the
   * 6:00 PM Ensaymada cutoff. Intentionally has no default: shipping with the
   * wrong timezone silently corrupts every order deadline, so it must be a
   * conscious decision. See docs/SCOPE.md "Open Items".
   */
  STORE_TIMEZONE: z
    .string()
    .refine(isIanaTimeZone, 'Must be an IANA timezone, e.g. "America/Los_Angeles"'),

  /**
   * The currency the store's Square location actually bills in. Square rejects
   * (and this app then silently filters out) any variation priced in a
   * different currency — see `mapCatalogItems`'s `expectedCurrency`. A store
   * outside the US almost certainly isn't USD, so this has no default for the
   * same reason STORE_TIMEZONE doesn't: guessing wrong here doesn't error, it
   * quietly empties the entire menu.
   */
  STORE_CURRENCY: z
    .string()
    .regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO 4217 currency code, e.g. "CAD"'),

  SQUARE_ACCESS_TOKEN: z.string().min(1),
  SQUARE_WEBHOOK_SIGNATURE_KEY: z.string().min(1),
  /** Must match the subscription URL in the Square console exactly — it is part of the signed payload. */
  SQUARE_WEBHOOK_NOTIFICATION_URL: z.url(),
  /** Used only by the one-time migration of pre-multi-location rows. */
  LEGACY_SQUARE_LOCATION_ID: optional(z.string().min(1)),

  /**
   * The shared staff-dashboard password.
   *
   * It is also, when the two secrets below are unset, the last-resort HMAC key for
   * five unrelated things: customer tracking links and `/o/[code]` short links
   * (lib/orders/access.ts), pickup-pass QR codes (lib/orders/pickup-pass.ts),
   * customer account cookies (lib/accounts/session.ts), signup tokens
   * (lib/accounts/signup-token.ts) and staff PIN hashes (lib/staff/roster.ts).
   *
   * So rotating it for hygiene invalidates every tracking link and pickup pass in
   * circulation, signs out every customer, and breaks every staff PIN. Set the two
   * secrets below explicitly and that coupling disappears.
   *
   * Note the asymmetry that makes this awkward to undo: this floor is 8 characters
   * and theirs is 32, so on a deployment whose password is shorter than 32 you
   * cannot adopt the explicit secrets *without* changing the effective key — which
   * is the invalidation you were trying to avoid. Schedule it for a moment when no
   * orders are awaiting collection.
   */
  STAFF_DASHBOARD_PASSWORD: z.string().min(8),
  /** Stable HMAC key for customer tracking links and pickup passes. */
  ORDER_ACCESS_SECRET: optional(z.string().min(32)),
  /** Separate HMAC key for customer-account sessions and signup tokens. */
  CUSTOMER_ACCOUNT_SECRET: optional(z.string().min(32)),

  // --- Notification channels. All optional: an unset channel is simply skipped
  // by the dispatcher, so the store can turn one on later without a code change.
  RESEND_API_KEY: optional(z.string()),
  /** Verified Resend sender, e.g. "Orders <orders@example.com>". */
  NOTIFY_FROM_EMAIL: optional(z.string().min(3)),
  STORE_NOTIFY_EMAIL: optional(z.email()),
  /** Optional JSON object mapping Square location ids to staff inboxes. */
  LOCATION_NOTIFY_EMAILS: optional(z.string()),
  TWILIO_ACCOUNT_SID: optional(z.string()),
  TWILIO_AUTH_TOKEN: optional(z.string()),
  TWILIO_FROM_NUMBER: optional(z.string()),
  STORE_NOTIFY_PHONE: optional(z.string()),
  /** Optional JSON object mapping Square location ids to staff SMS numbers. */
  LOCATION_NOTIFY_PHONES: optional(z.string()),
  DISCORD_WEBHOOK_URL: optional(z.url()),
  SLACK_WEBHOOK_URL: optional(z.url()),
  TRELLO_KEY: optional(z.string()),
  TRELLO_TOKEN: optional(z.string()),
  TRELLO_LIST_ID: optional(z.string()),
  CUSTOM_WEBHOOK_URL: optional(z.url()),
  /**
   * Sentry server DSN — errors-only monitoring (see instrumentation.ts). Unset
   * disables it entirely. The SDK reads process.env directly; this entry exists
   * so the variable is documented and validated alongside everything else.
   */
  SENTRY_DSN: optional(z.url()),
  /** Protects scheduled maintenance routes. */
  CRON_SECRET: optional(z.string().min(16)),
  /** Canonical public origin used in customer notification links. */
  STORE_PUBLIC_URL: optional(z.url()),
  /** Closed orders are anonymized after this many days. Unset disables it. */
  CUSTOMER_DATA_RETENTION_DAYS: optional(z.coerce.number().int().min(30).max(3650)),
}).superRefine((env, context) => {
  if (env.RESEND_API_KEY && !env.NOTIFY_FROM_EMAIL) {
    context.addIssue({
      code: "custom",
      path: ["NOTIFY_FROM_EMAIL"],
      message: "NOTIFY_FROM_EMAIL is required when RESEND_API_KEY is configured",
    });
  }
});

const publicSchema = z.object({
  NEXT_PUBLIC_SQUARE_APPLICATION_ID: z.string().min(1),
  NEXT_PUBLIC_SQUARE_ENVIRONMENT: z.enum(["sandbox", "production"]),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type PublicEnv = z.infer<typeof publicSchema>;

let cachedServerEnv: ServerEnv | undefined;

/**
 * Validated server environment. Lazy so that importing a module which touches
 * env doesn't blow up at build time in environments where secrets aren't present
 * (e.g. `next build` on CI without a database).
 */
export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() was called in the browser — it would leak secrets.");
  }
  if (!cachedServerEnv) {
    const parsed = serverSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`Invalid server environment:\n${issues}\n\nSee .env.example.`);
    }
    cachedServerEnv = parsed.data;
  }
  return cachedServerEnv;
}

let cachedPublicEnv: PublicEnv | undefined;

/**
 * Validated public environment.
 *
 * Lazy for the same reason as serverEnv(): validating at module scope would fail
 * `next build` in any environment where the vars aren't present, including CI.
 *
 * The `process.env.NEXT_PUBLIC_*` reads are written out literally because the
 * Next.js compiler replaces them textually at build time — rewriting this as a
 * loop over key names would leave them `undefined` in the browser bundle.
 */
export function publicEnv(): PublicEnv {
  if (!cachedPublicEnv) {
    const parsed = publicSchema.safeParse({
      NEXT_PUBLIC_SQUARE_APPLICATION_ID: process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID,
      NEXT_PUBLIC_SQUARE_ENVIRONMENT: process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT,
    });
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`Invalid public environment:\n${issues}\n\nSee .env.example.`);
    }
    cachedPublicEnv = parsed.data;
  }
  return cachedPublicEnv;
}
