"use server";

import { updateTag } from "next/cache";
import { z } from "zod";

import { requireStaffSession } from "@/lib/auth/guard";
import { revokeDevice } from "@/lib/auth/device-session";
import {
  addBlackoutDate,
  applyProductRulesBulk,
  isSlugConflict,
  productIdForSlug,
  clearSlotCapacity,
  removeBlackoutDate,
  saveProductRules,
  setSlotCapacity,
} from "@/lib/admin/queries";
import {
  blackoutSchema,
  bulkProductRulesSchema,
  parsePickupTimes,
  productRulesSchema,
  slotCapacitySchema,
  slugFromName,
  warnAboutRules,
} from "@/lib/admin/validate";
import { CATALOG_TAG, PRODUCT_CONFIG_TAG, getStoreCatalog } from "@/lib/catalog/server";
import { getStoreLocation } from "@/lib/locations/server";
import { recordAudit } from "@/lib/audit/log";
import { saveStaffMember, setStaffMemberActive } from "@/lib/staff/roster";
import {
  clearSoldOut,
  markSoldOut,
  pauseInputSchema,
  pauseOrdering,
  soldOutInputSchema,
} from "@/lib/staff/service-controls";
import { serverEnv } from "@/lib/env";
import {
  NOTIFY_RECIPIENTS_KEY,
  notificationRecipientsSchema,
} from "@/lib/settings/notifications";
import { setSlotCapacityDefault } from "@/lib/settings/capacity";
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

  /* Pre-check so a duplicate URL name says so, instead of surfacing a raw
     unique violation the form reports as "check your connection". */
  const slugOwner = await productIdForSlug(parsed.data.slug);
  if (slugOwner && slugOwner !== parsed.data.productId) {
    return {
      ok: false,
      error: "Another product already uses that URL name.",
      fieldErrors: { slug: ["Already taken — try adding the size or flavour"] },
    };
  }

  try {
    await saveProductRules({
      productId: parsed.data.productId,
      slug: parsed.data.slug,
      sortOrder: parsed.data.sortOrder,
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
  } catch (cause) {
    /* Two saves racing on the same name: the pre-check passed for both and the
       database settled it. Same message, so the outcome reads identically. */
    if (isSlugConflict(cause)) {
      return {
        ok: false,
        error: "Another product already uses that URL name.",
        fieldErrors: { slug: ["Already taken — try adding the size or flavour"] },
      };
    }
    throw cause;
  }

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

/**
 * Apply one rule set to many products.
 *
 * Product names are resolved from the catalog rather than taken from the
 * request: the catalog is authoritative, it means an id Square no longer has
 * cannot create an orphan row, and the derived slug is then based on the same
 * name the storefront shows.
 */
export async function saveProductRulesBulkAction(input: unknown): Promise<AdminResult> {
  await requireStaffSession();

  const parsed = bulkProductRulesSchema.safeParse(input);
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

  const catalog = await getStoreCatalog();
  if (catalog.error) {
    return { ok: false, error: "Couldn't read the catalog from Square. Try again in a moment." };
  }

  const nameById = new Map(
    [...catalog.products, ...catalog.unconfigured].map((product) => [product.id, product.name]),
  );
  const targets = parsed.data.productIds.flatMap((productId) => {
    const name = nameById.get(productId);
    return name ? [{ productId, name }] : [];
  });

  if (targets.length === 0) {
    return { ok: false, error: "Those products are no longer in your Square catalog." };
  }

  const result = await applyProductRulesBulk(targets, {
    leadTimeDays: parsed.data.leadTimeDays,
    orderCutoffTime: parsed.data.orderCutoffTime,
    allowedPickupTimes: times.times,
    maxUnitsPerDay: parsed.data.maxUnitsPerDay,
    isOrderable: parsed.data.isOrderable,
    allergens: parsed.data.allergens,
    dietaryTags: parsed.data.dietaryTags,
  });

  updateTag(PRODUCT_CONFIG_TAG);
  await recordAudit({
    actorType: "staff",
    action: "product.rules_bulk_applied",
    entityType: "product",
    metadata: {
      configured: result.configured,
      updated: result.updated,
      leadTimeDays: parsed.data.leadTimeDays,
      orderCutoffTime: parsed.data.orderCutoffTime,
    },
  });

  const warnings = [
    ...(targets.length < parsed.data.productIds.length
      ? [`${parsed.data.productIds.length - targets.length} product(s) were skipped — Square no longer lists them.`]
      : []),
    ...warnAboutRules({
      leadTimeDays: parsed.data.leadTimeDays,
      orderCutoffTime: parsed.data.orderCutoffTime,
      pickupTimes: times.times,
    }),
    ...result.newSlugs
      .filter((entry) => entry.slug !== slugFromName(entry.name))
      .map((entry) => `"${entry.name}" got the URL name "${entry.slug}" — its preferred one was taken.`),
  ];

  return { ok: true, warnings };
}

/**
 * Set how many orders a pickup slot accepts by default.
 *
 * Counts orders rather than items: it bounds how many customers the counter can
 * hand over to in one window. Per-product volume is a separate constraint and
 * lives on the product's own rules.
 */
export async function setSlotCapacityDefaultAction(input: unknown): Promise<AdminResult> {
  await requireStaffSession();

  const parsed = z
    .object({
      locationId: z.union([z.string().min(1), z.null()]),
      maxOrdersPerSlot: z.coerce
        .number()
        .int("Whole orders only")
        .min(1, "A slot has to accept at least one order")
        .max(500),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Enter a whole number of orders.", fieldErrors: flatten(parsed.error) };
  }

  if (parsed.data.locationId && !(await getStoreLocation(parsed.data.locationId))) {
    return { ok: false, error: "That pickup location is no longer active." };
  }

  await setSlotCapacityDefault(parsed.data.locationId, parsed.data.maxOrdersPerSlot);
  updateTag(SETTINGS_TAG);
  // Capacity feeds the storefront calendar, which is cached under this tag.
  updateTag(PRODUCT_CONFIG_TAG);
  await recordAudit({
    actorType: "staff",
    action: "capacity.default_set",
    entityType: "location",
    entityId: parsed.data.locationId,
    metadata: { maxOrdersPerSlot: parsed.data.maxOrdersPerSlot },
  });

  return { ok: true };
}

/**
 * Cut off one phone or tablet.
 *
 * The point of the staff_devices table: before it, the only way to invalidate a
 * staff session was to change the shared password, which signed out every
 * counter tablet at once. Revoking here stops exactly one device and touches
 * nothing else.
 */
export async function revokeStaffDeviceAction(input: unknown): Promise<AdminResult> {
  await requireStaffSession();

  const parsed = z.object({ deviceId: z.uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That device is no longer listed." };
  }

  const revoked = await revokeDevice(parsed.data.deviceId);
  if (!revoked) {
    // Already revoked, or gone. Say so rather than claiming to have acted.
    return { ok: false, error: "That device had already been signed out." };
  }

  await recordAudit({
    actorType: "staff",
    action: "staff_device.revoked",
    entityType: "staff_device",
    entityId: parsed.data.deviceId,
  });

  return { ok: true };
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

/**
 * One-tap "stop taking orders" from the dashboard header (and settings).
 *
 * A thin adapter: authorise, hand the parsed input to the shared service, and
 * translate the result into what the forms expect. The staff app's API route is
 * the same three lines with a different notion of "authorise" and "report".
 */
export async function setOrderingPauseAction(input: unknown): Promise<AdminResult> {
  await requireStaffSession();
  const parsed = pauseInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the pause details." };
  return pauseOrdering(parsed.data, updateTag);
}

/** "Sold out today": block one product for one date without touching its permanent settings. */
export async function add86Action(input: unknown): Promise<AdminResult> {
  await requireStaffSession();
  const parsed = soldOutInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the product, date, and locations." };
  return markSoldOut(parsed.data, updateTag);
}

export async function remove86Action(input: unknown): Promise<AdminResult> {
  await requireStaffSession();
  const parsed = z
    .object({ id: z.uuid(), staffInitials: z.string().trim().max(6).optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "That entry no longer exists." };
  return clearSoldOut(parsed.data.id, updateTag, parsed.data.staffInitials);
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
