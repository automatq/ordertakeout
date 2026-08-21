import { z } from "zod";

import { isAllowedProductImageSource } from "@/lib/catalog/image-policy";
import { compareTimes, normalizeTime, type StoreTime } from "@/lib/scheduling/time";

/**
 * Validation for the admin screens.
 *
 * Pure and separate from the server actions so the parsing rules — especially
 * the pickup-times field, which staff type by hand — can be tested directly.
 */

export const MAX_LEAD_TIME_DAYS = 30;
export const MAX_UNITS_PER_DAY = 10_000;

const TIME_PATTERN = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export type PickupTimesResult =
  | { ok: true; times: StoreTime[] }
  | { ok: false; invalid: string[] };

/**
 * Parse the pickup-times field, which staff type as free text.
 *
 * Deliberately forgiving about separators and padding — "4:00 PM, 5pm" is not
 * accepted, but "16:00,17:00" and "16:00 17:00" and "9:00, 16:00" all are.
 * Results are sorted and de-duplicated so the storefront order is stable no
 * matter how they were entered.
 */
export function parsePickupTimes(input: string): PickupTimesResult {
  const tokens = input
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) return { ok: false, invalid: [] };

  const invalid = tokens.filter((token) => !TIME_PATTERN.test(token));
  if (invalid.length > 0) return { ok: false, invalid };

  const normalized = tokens.map((token) => {
    // Accept "9:00" as well as "09:00" — the pattern allows a single leading
    // digit, but everything downstream compares times as strings and needs the
    // zero-padded form.
    const [hours, minutes] = token.split(":") as [string, string];
    return normalizeTime(`${hours.padStart(2, "0")}:${minutes}`);
  });

  const unique = [...new Set(normalized)].sort(compareTimes);
  return { ok: true, times: unique };
}

const timeField = z
  .string()
  .refine((value) => TIME_PATTERN.test(value.trim()), "Use a 24-hour time such as 18:00");

export const productRulesSchema = z.object({
  productId: z.string().min(1),
  slug: z
    .string()
    .trim()
    .min(1, "Give the product a short URL name")
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens"),
  leadTimeDays: z.coerce
    .number()
    .int("Whole days only")
    .min(0, "Lead time can't be negative")
    .max(MAX_LEAD_TIME_DAYS),
  orderCutoffTime: timeField,
  pickupTimes: z.string().min(1, "Add at least one pickup time"),
  /** Blank means unlimited — the store often doesn't want a cap at all. */
  maxUnitsPerDay: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(MAX_UNITS_PER_DAY)])
    .transform((value) => (value === "" ? null : value)),
  isOrderable: z.enum(["true", "false"]).transform((value) => value === "true"),
  descriptionMd: z.string().trim().max(2000).optional(),
  /**
   * Staff override for the product photo.
   *
   * The column has existed since the first migration and nothing ever wrote to
   * it, so every product fell back to a typographic tile. Square's own images
   * are resolved automatically (lib/catalog/images.ts); this is for the case
   * where the item's Square photo isn't the one the shop wants to lead with.
   *
   * Blank clears it, which is why the empty string is a valid value rather than
   * a validation failure.
   */
  heroImageUrl: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || isAllowedProductImageSource(value),
      "Use a /harina/ image or an HTTPS image supplied by Square",
    )
    .optional()
    .transform((value) => (value ? value : null)),
});

export type ProductRulesInput = z.input<typeof productRulesSchema>;

export const blackoutSchema = z.object({
  locationId: z.string().min(1, "Choose a location"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  reason: z.string().trim().max(200).optional(),
});

export const slotCapacitySchema = z.object({
  locationId: z.string().min(1, "Choose a location"),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  pickupTime: timeField,
  maxOrders: z.coerce
    .number()
    .int("Whole orders only")
    .min(0, "Use 0 to close the slot entirely")
    .max(500),
});

/**
 * Cross-field check: a cutoff outside the pickup window is legal but almost
 * always a mistake, so it's surfaced as a warning rather than blocking the save.
 */
export function warnAboutRules(rules: {
  leadTimeDays: number;
  orderCutoffTime: string;
  pickupTimes: StoreTime[];
}): string[] {
  const warnings: string[] = [];

  if (rules.pickupTimes.length === 0) {
    warnings.push("No pickup times means customers can never order this product.");
  }

  if (rules.leadTimeDays === 0) {
    warnings.push(
      "A zero-day lead time allows same-day orders right up to the cutoff. Make sure the kitchen can meet that.",
    );
  }

  const earliest = rules.pickupTimes[0];
  if (
    rules.leadTimeDays === 0 &&
    earliest &&
    compareTimes(normalizeTime(rules.orderCutoffTime), earliest) > 0
  ) {
    warnings.push(
      `The cutoff (${rules.orderCutoffTime}) is after the first pickup time (${earliest}), so the earliest slots may be unreachable.`,
    );
  }

  return warnings;
}
