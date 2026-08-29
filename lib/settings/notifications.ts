import "server-only";

import { z } from "zod";

import { serverEnv } from "@/lib/env";
import { reportError } from "@/lib/monitoring/report";

import { getSettingFresh } from "./store";

/**
 * Who the store's notifications go to — self-serviceable at last.
 *
 * Recipients live in app_settings; provider API keys stay in env on purpose (a
 * database-backed settings screen must never hold secrets next to order data).
 * The env variables remain as fallbacks so existing deployments keep working
 * untouched, and a stored-but-empty list with `useEnvFallback: false` means
 * deliberately silent rather than misconfigured.
 *
 * Resolution is a FRESH read per send — notifications are a handful per day,
 * and a recipient change must apply to the very next order.
 */

export const NOTIFY_RECIPIENTS_KEY = "notify.recipients";

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
const PHONE_PATTERN = /^\+?[\d ()-]{7,}$/;

export const notificationRecipientsSchema = z.object({
  useEnvFallback: z.boolean(),
  storeEmails: z.array(z.string().regex(EMAIL_PATTERN)).max(5),
  storePhone: z.string().regex(PHONE_PATTERN).nullable(),
  /** Square location id → address/number, for multi-branch routing. */
  locationEmails: z.record(z.string(), z.string().regex(EMAIL_PATTERN)),
  locationPhones: z.record(z.string(), z.string().regex(PHONE_PATTERN)),
});

export type NotificationRecipients = z.infer<typeof notificationRecipientsSchema>;

/** The env-derived defaults; malformed JSON maps are reported, never silently swallowed. */
export function recipientsFromEnv(): NotificationRecipients {
  const env = serverEnv();
  return {
    useEnvFallback: true,
    storeEmails: env.STORE_NOTIFY_EMAIL ? [env.STORE_NOTIFY_EMAIL] : [],
    storePhone: env.STORE_NOTIFY_PHONE && PHONE_PATTERN.test(env.STORE_NOTIFY_PHONE)
      ? env.STORE_NOTIFY_PHONE
      : null,
    locationEmails: parseEnvMap(env.LOCATION_NOTIFY_EMAILS, EMAIL_PATTERN, "LOCATION_NOTIFY_EMAILS"),
    locationPhones: parseEnvMap(env.LOCATION_NOTIFY_PHONES, PHONE_PATTERN, "LOCATION_NOTIFY_PHONES"),
  };
}

export async function getNotificationRecipients(): Promise<NotificationRecipients> {
  const stored = await getSettingFresh(NOTIFY_RECIPIENTS_KEY, notificationRecipientsSchema);
  return stored ?? recipientsFromEnv();
}

/** Location inbox → configured store list → env fallback (when allowed). */
export async function resolveStoreEmails(locationId?: string | null): Promise<string[]> {
  const stored = await getSettingFresh(NOTIFY_RECIPIENTS_KEY, notificationRecipientsSchema);
  const active = stored ?? recipientsFromEnv();

  const located = locationId ? active.locationEmails[locationId] : undefined;
  if (located) return [located];
  if (active.storeEmails.length) return active.storeEmails;

  if (stored?.useEnvFallback) {
    const env = recipientsFromEnv();
    const envLocated = locationId ? env.locationEmails[locationId] : undefined;
    if (envLocated) return [envLocated];
    return env.storeEmails;
  }
  return [];
}

export async function resolveStorePhone(locationId?: string | null): Promise<string | null> {
  const stored = await getSettingFresh(NOTIFY_RECIPIENTS_KEY, notificationRecipientsSchema);
  const active = stored ?? recipientsFromEnv();

  const located = locationId ? active.locationPhones[locationId] : undefined;
  if (located) return located;
  if (active.storePhone) return active.storePhone;

  if (stored?.useEnvFallback) {
    const env = recipientsFromEnv();
    return (locationId ? env.locationPhones[locationId] : undefined) ?? env.storePhone;
  }
  return null;
}

function parseEnvMap(
  raw: string | undefined,
  pattern: RegExp,
  name: string,
): Record<string, string> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      reportError("notifications", `${name} must be a JSON object of location id → destination`);
      return {};
    }
    const entries = Object.entries(value as Record<string, unknown>).flatMap(([key, destination]) =>
      typeof destination === "string" && pattern.test(destination) ? [[key, destination] as const] : [],
    );
    return Object.fromEntries(entries);
  } catch {
    reportError("notifications", `${name} is not valid JSON`);
    return {};
  }
}
