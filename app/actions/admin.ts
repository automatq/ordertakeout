"use server";

import { updateTag } from "next/cache";
import { z } from "zod";

import { requireStaffSession } from "@/lib/auth/guard";
import {
  addAvailabilityOverride,
  addBlackoutDate,
  clearSlotCapacity,
  removeAvailabilityOverride,
  removeBlackoutDate,
  saveProductRules,
  setSlotCapacity,
} from "@/lib/admin/queries";
import {
  blackoutSchema,
  parsePickupTimes,
  productRulesSchema,
  slotCapacitySchema,
  warnAboutRules,
} from "@/lib/admin/validate";
import { CATALOG_TAG, PRODUCT_CONFIG_TAG } from "@/lib/catalog/server";
import { getStoreLocation } from "@/lib/locations/server";
import { recordAudit } from "@/lib/audit/log";
import { saveStaffMember, setStaffMemberActive } from "@/lib/staff/roster";
import { serverEnv } from "@/lib/env";
import { storeToday } from "@/lib/scheduling/time";
import {
  NOTIFY_RECIPIENTS_KEY,
  notificationRecipientsSchema,
} from "@/lib/settings/notifications";
import { setOrderingPause } from "@/lib/settings/pause";
import { setSetting, SETTINGS_TAG } from "@/lib/settings/store";

/**
 * Admin actions.
 *
 * Every one re-checks the session — server actions are independently addressable
 * endpoints, so a page-level guard alone would leave them open.
 *
 * Every write that changes what the storefront shows invalidates the cached
 * catalog. Without that, staff would change a cutoff, see no difference, and
 * reasonably conclude the form is broken.
 */

export type AdminResult =
  | { ok: true; warnings?: string[] }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

const flatten = (error: z.ZodError): Record<string, string[]> =>
  z.flattenError(error).fieldErrors as Record<string, string[]>;

export async function saveProductRulesAction(formData: FormData): Promise<AdminResult> {
  await requireStaffSession();

  const parsed = productRulesSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: flatten(parsed.error) };
  }

  const times = parsePickupTimes(parsed.data.pickupTimes);
  if (!times.ok) {
    return {
      ok: false,
      error:
        times.invalid.length > 0
          ? `Not a valid 24-hour time: ${times.invalid.join(", ")}`
          : "Add at least one pickup time.",
      fieldErrors: { pickupTimes: ["Use 24-hour times, e.g. 16:00, 17:00"] },
    };
  }

  await saveProductRules({
    productId: parsed.data.productId,
    slug: parsed.data.slug,
    leadTimeDays: parsed.data.leadTimeDays,
    orderCutoffTime: parsed.data.orderCutoffTime,
    allowedPickupTimes: times.times,
    maxUnitsPerDay: parsed.data.maxUnitsPerDay,
    isOrderable: parsed.data.isOrderable,
    descriptionMd: parsed.data.descriptionMd ?? null,
    heroImageUrl: parsed.data.heroImageUrl ?? null,
    allergens: parsed.data.allergens,
    dietaryTags: parsed.data.dietaryTags,
  });

  updateTag(PRODUCT_CONFIG_TAG);

  // Saved either way — these are "are you sure?" notes, not errors.
  return {
    ok: true,
    warnings: warnAboutRules({
      leadTimeDays: parsed.data.leadTimeDays,
      orderCutoffTime: parsed.data.orderCutoffTime,
      pickupTimes: times.times,
    }),
  };
}

export async function addBlackoutAction(formData: FormData): Promise<AdminResult> {
  await requireStaffSession();

  const parsed = blackoutSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "Pick a valid date.", fieldErrors: flatten(parsed.error) };
  }

  if (!(await getStoreLocation(parsed.data.locationId))) {
    return { ok: false, error: "That pickup location is no longer active." };
  }

  await addBlackoutDate(parsed.data.locationId, parsed.data.date, parsed.data.reason || null);
  updateTag(PRODUCT_CONFIG_TAG);
  return { ok: true };
}

export async function removeBlackoutAction(formData: FormData): Promise<AdminResult> {
  await requireStaffSession();

  const date = String(formData.get("date") ?? "");
  const locationId = String(formData.get("locationId") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(await getStoreLocation(locationId))) {
    return { ok: false, error: "Pick a valid date." };
  }

  await removeBlackoutDate(locationId, date);
  updateTag(PRODUCT_CONFIG_TAG);
  return { ok: true };
}

export async function setSlotCapacityAction(formData: FormData): Promise<AdminResult> {
  await requireStaffSession();

  const parsed = slotCapacitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "Check the slot details.", fieldErrors: flatten(parsed.error) };
  }

  if (!(await getStoreLocation(parsed.data.locationId))) {
    return { ok: false, error: "That pickup location is no longer active." };
  }

  await setSlotCapacity(parsed.data.locationId, parsed.data.pickupDate, parsed.data.pickupTime, parsed.data.maxOrders);
  updateTag(PRODUCT_CONFIG_TAG);
  return {
    ok: true,
    warnings:
      parsed.data.maxOrders === 0
        ? ["A cap of 0 closes that pickup time completely."]
        : undefined,
  };
}

export async function clearSlotCapacityAction(formData: FormData): Promise<AdminResult> {
  await requireStaffSession();

  const pickupDate = String(formData.get("pickupDate") ?? "");
  const pickupTime = String(formData.get("pickupTime") ?? "");
  const locationId = String(formData.get("locationId") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate) || !/^\d{2}:\d{2}/.test(pickupTime) || !(await getStoreLocation(locationId))) {
    return { ok: false, error: "Pick a valid slot." };
  }

  await clearSlotCapacity(locationId, pickupDate, pickupTime);
  updateTag(PRODUCT_CONFIG_TAG);
  return { ok: true };
}

/** Pull fresh item names and prices from Square right now. */
export async function resyncCatalogAction(): Promise<AdminResult> {
  await requireStaffSession();
  updateTag(CATALOG_TAG);
  updateTag(PRODUCT_CONFIG_TAG);
  return { ok: true };
}

const pauseActionSchema = z.object({
  scope: z.union([z.literal("global"), z.object({ locationId: z.string().min(1) })]),
  paused: z.boolean(),
  note: z.string().trim().max(200).optional(),
  /** Optional auto-resume, minutes from now. */
  resumeMinutes: z.number().int().min(5).max(24 * 60).optional(),
  staffInitials: z.string().trim().max(6).optional(),
});

/** One-tap "stop taking orders" from the dashboard header (and settings). */
export async function setOrderingPauseAction(input: unknown): Promise<AdminResult> {
  await requireStaffSession();
  const parsed = pauseActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the pause details." };

  const { scope, paused, note, resumeMinutes, staffInitials } = parsed.data;
  if (scope !== "global" && !(await getStoreLocation(scope.locationId))) {
    return { ok: false, error: "That pickup location is no longer active." };
  }

  const initials = staffInitials?.trim().toUpperCase() || null;
  await setOrderingPause(scope, {
    paused,
    note: paused ? note?.trim() || null : null,
    resumeAt: paused && resumeMinutes
      ? new Date(Date.now() + resumeMinutes * 60_000).toISOString()
      : null,
    setBy: initials,
  });
  updateTag(SETTINGS_TAG);

  await recordAudit({
    actorType: "staff",
    actorInitials: initials,
    action: paused ? "ordering.paused" : "ordering.resumed",
    entityType: scope === "global" ? "store" : "location",
    entityId: scope === "global" ? "global" : scope.locationId,
    metadata: { note: note?.trim() || null, resumeMinutes: resumeMinutes ?? null },
  });
  return { ok: true };
}

const eightySixSchema = z.object({
  productId: z.string().min(1),
  /** Explicit location ids — the quick action fans out one row per location. */
  locationIds: z.array(z.string().min(1)).min(1).max(20),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().max(120).optional(),
  staffInitials: z.string().trim().max(6).optional(),
});

/** "Sold out today": block one product for one date without touching its permanent settings. */
export async function add86Action(input: unknown): Promise<AdminResult> {
  await requireStaffSession();
  const parsed = eightySixSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the product, date, and locations." };

  const { productId, locationIds, date, reason, staffInitials } = parsed.data;
  const today = storeToday(new Date(), serverEnv().STORE_TIMEZONE);
  if (date < today) return { ok: false, error: "Pick today or a future date." };
  for (const locationId of locationIds) {
    if (!(await getStoreLocation(locationId))) {
      return { ok: false, error: "One of those pickup locations is no longer active." };
    }
  }

  const initials = staffInitials?.trim().toUpperCase() || null;
  for (const locationId of locationIds) {
    await addAvailabilityOverride({
      productId,
      locationId,
      date,
      reason: reason?.trim() || null,
      createdBy: initials,
    });
  }
  updateTag(PRODUCT_CONFIG_TAG);
  await recordAudit({
    actorType: "staff",
    actorInitials: initials,
    action: "product.86ed",
    entityType: "product",
    entityId: productId,
    metadata: { date, locationIds, reason: reason?.trim() || null },
  });
  return { ok: true };
}

export async function remove86Action(input: unknown): Promise<AdminResult> {
  await requireStaffSession();
  const parsed = z.object({ id: z.uuid(), staffInitials: z.string().trim().max(6).optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That entry no longer exists." };

  await removeAvailabilityOverride(parsed.data.id);
  updateTag(PRODUCT_CONFIG_TAG);
  await recordAudit({
    actorType: "staff",
    actorInitials: parsed.data.staffInitials?.trim().toUpperCase() || null,
    action: "product.86_removed",
    entityType: "product",
    entityId: parsed.data.id,
  });
  return { ok: true };
}

const staffMemberSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(80),
  initials: z.string().trim().min(2).max(6),
  /** Empty string = leave unchanged; "clear" = remove; 4 digits = set. */
  pin: z.union([z.literal(""), z.literal("clear"), z.string().regex(/^\d{4}$/)]).optional(),
  active: z.boolean().optional(),
});

export async function saveStaffMemberAction(input: unknown): Promise<AdminResult> {
  await requireStaffSession();
  const parsed = staffMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the name, initials, and PIN." };

  const { id, name, initials, pin, active } = parsed.data;
  const result = await saveStaffMember({
    id,
    name,
    initials,
    pin: pin === "" || pin === undefined ? undefined : pin === "clear" ? null : pin,
    active,
  });
  if (!result.ok) return { ok: false, error: result.message };

  await recordAudit({
    actorType: "staff",
    actorInitials: null,
    action: id ? "staff.updated" : "staff.added",
    entityType: "staff_member",
    entityId: result.id,
    metadata: { name, initials: initials.toUpperCase(), pinChanged: pin !== undefined && pin !== "" },
  });
  return { ok: true };
}

export async function setStaffMemberActiveAction(input: unknown): Promise<AdminResult> {
  await requireStaffSession();
  const parsed = z.object({ id: z.uuid(), active: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That staff member no longer exists." };

  await setStaffMemberActive(parsed.data.id, parsed.data.active);
  await recordAudit({
    actorType: "staff",
    actorInitials: null,
    action: parsed.data.active ? "staff.reactivated" : "staff.deactivated",
    entityType: "staff_member",
    entityId: parsed.data.id,
  });
  return { ok: true };
}

const recipientsActionSchema = z.object({
  useEnvFallback: z.boolean(),
  storeEmails: z.array(z.string().trim().regex(/^\S+@\S+\.\S+$/)).max(5),
  storePhone: z.string().trim().regex(/^\+?[\d ()-]{7,}$/).nullable(),
  locationEmails: z.record(z.string().min(1), z.string().trim().regex(/^\S+@\S+\.\S+$/)),
  locationPhones: z.record(z.string().min(1), z.string().trim().regex(/^\+?[\d ()-]{7,}$/)),
});

/** Recipients only — provider API keys stay in env, never in the database. */
export async function saveNotificationRecipientsAction(input: unknown): Promise<AdminResult> {
  await requireStaffSession();
  const parsed = recipientsActionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the email addresses and phone numbers." };
  }

  await setSetting(NOTIFY_RECIPIENTS_KEY, notificationRecipientsSchema, parsed.data);
  updateTag(SETTINGS_TAG);
  await recordAudit({
    actorType: "staff",
    actorInitials: null,
    action: "settings.updated",
    entityType: "settings",
    entityId: NOTIFY_RECIPIENTS_KEY,
    metadata: {
      storeEmailCount: parsed.data.storeEmails.length,
      hasStorePhone: parsed.data.storePhone !== null,
      locationOverrides:
        Object.keys(parsed.data.locationEmails).length + Object.keys(parsed.data.locationPhones).length,
      useEnvFallback: parsed.data.useEnvFallback,
    },
  });
  return { ok: true };
}
