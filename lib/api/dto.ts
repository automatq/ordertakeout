import { z } from "zod";

import { summariseProduction } from "@/lib/orders/dashboard";
import type { DashboardData, DashboardOrder } from "@/lib/orders/dashboard";
import type { PickupVerificationPreview } from "@/lib/orders/pickup-verification";
import type { StoreProduct } from "@/lib/catalog/types";
import type { StoreLocation } from "@/lib/locations/types";
import { normalizeTime } from "@/lib/scheduling/time";

/**
 * What a staff client is allowed to see.
 *
 * `DashboardOrder extends Order`, and `Order` is the raw Drizzle row — 43
 * columns including `paymentAttemptSourceId` (an opaque Square card token),
 * `paymentAttemptKey`, `refundAttemptKey`, `squarePaymentId`, `squareSyncError`
 * and `refundError`. Those are safe today only because a server-rendered page
 * reads the row and renders a dozen fields from it. `Response.json(order)` would
 * put every one of them on every staff phone and make it a contract we cannot
 * withdraw.
 *
 * So the mapping is explicit and additive: a new column on `orders` appears here
 * only when someone decides it should. The schema is exported so a test can
 * parse real responses under `.strict()` — that is what catches a field added by
 * spreading a row somewhere downstream.
 */

export const queueItemSchema = z
  .object({
    name: z.string(),
    quantity: z.number().int(),
  })
  .strict();

export const queueOrderSchema = z
  .object({
    id: z.string(),
    orderNumber: z.string(),
    customerName: z.string(),
    /* Staff ring customers about late pickups from the counter. Email is not
       here: nobody emails from a queue screen, so it would be exposure without
       a use. */
    customerPhone: z.string().nullable(),
    pickupDate: z.string(),
    pickupTime: z.string(),
    status: z.string(),
    totalCents: z.number().int(),
    currency: z.string(),
    customerNote: z.string().nullable(),
    staffNote: z.string().nullable(),
    locationName: z.string().nullable(),
    items: z.array(queueItemSchema),
    /* Whether this order has already been handed over, so the queue can show it
       without a second request. The method and the initials who did it are
       audit detail and stay server-side. */
    verifiedAt: z.string().nullable(),
  })
  .strict();

export const queueSlotSchema = z
  .object({
    time: z.string(),
    capacity: z.number().int(),
    orders: z.array(queueOrderSchema),
  })
  .strict();

export const queueDaySchema = z
  .object({
    date: z.string(),
    orderCount: z.number().int(),
    /* What the kitchen bakes from. Summed server-side with the same function the
       web timeline uses, rather than re-added from `items` on the phone — two
       implementations of "what do we make today" is exactly the kind of thing
       that quietly disagrees, and cancelled orders are the reason it would. */
    production: z.array(queueItemSchema),
    slots: z.array(queueSlotSchema),
  })
  .strict();

export const queueResponseSchema = z
  .object({
    today: z.string(),
    newOrderCount: z.number().int(),
    days: z.array(queueDaySchema),
  })
  .strict();

export type QueueOrder = z.infer<typeof queueOrderSchema>;
export type QueueResponse = z.infer<typeof queueResponseSchema>;

function toQueueOrder(order: DashboardOrder): QueueOrder {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    pickupDate: order.pickupDate,
    /* Postgres `time` columns come back as HH:mm:ss while everything else in the
       app uses HH:mm. Normalising here means one shape on the wire instead of
       every client having to tolerate both. */
    pickupTime: normalizeTime(order.pickupTime),
    status: order.status,
    totalCents: order.totalCents,
    currency: order.currency,
    customerNote: order.customerNote,
    staffNote: order.staffNote,
    locationName: order.pickupLocationName,
    items: order.items.map((item) => ({
      name: item.nameSnapshot,
      quantity: item.quantity,
    })),
    /* Dates cross the wire as ISO strings. Pickup date and time are deliberately
       not Dates at all — they are bare store-local strings, and round-tripping
       them through a Date is how a pickup silently moves a day. */
    verifiedAt: order.pickupVerification?.verifiedAt?.toISOString() ?? null,
  };
}

export function toQueueResponse(data: DashboardData): QueueResponse {
  return {
    today: data.today,
    newOrderCount: data.newOrderCount,
    days: data.days.map((day) => ({
      date: day.date,
      orderCount: day.orderCount,
      production: summariseProduction(day.slots.flatMap((slot) => slot.orders)),
      slots: day.slots.map((slot) => ({
        time: slot.time,
        capacity: slot.capacity,
        orders: slot.orders.map(toQueueOrder),
      })),
    })),
  };
}


/**
 * Pickup verification, for the staff app's scanner.
 *
 * `PickupVerificationPreview` is already a hand-built shape rather than a
 * database row, so this mapping is close to one-to-one. It exists anyway, for
 * the same reason as the queue DTO: the day somebody widens that type to carry
 * "just one more field" from the order row, this is what stops it reaching a
 * phone, and the `.strict()` schema is what makes the test fail.
 */
export const pickupPreviewSchema = z
  .object({
    orderId: z.string(),
    orderNumber: z.string(),
    customerName: z.string(),
    pickupDate: z.string(),
    pickupTime: z.string(),
    pickupLocationName: z.string().nullable(),
    itemCount: z.number().int(),
    method: z.enum(["qr", "manual"]),
  })
  .strict();

export const pickupVerifiedSchema = z
  .object({
    orderId: z.string(),
    orderNumber: z.string(),
    /* Collection succeeded but Square did not hear about it. Staff must be told,
       because the order is handed over either way and the books will disagree. */
    squareWarning: z.string().optional(),
  })
  .strict();

export type PickupPreview = z.infer<typeof pickupPreviewSchema>;

export function toPickupPreview(preview: PickupVerificationPreview): PickupPreview {
  return {
    orderId: preview.orderId,
    orderNumber: preview.orderNumber,
    customerName: preview.customerName,
    pickupDate: preview.pickupDate,
    pickupTime: normalizeTime(preview.pickupTime),
    pickupLocationName: preview.pickupLocationName,
    itemCount: preview.itemCount,
    method: preview.method,
  };
}


/**
 * The menu, for the customer app.
 *
 * Narrower than the storefront's own product type on purpose. `StoreProduct`
 * carries the whole `ProductRule` — max units per day, whether it is orderable
 * at all, the raw sort order — which is how the shop is run, not what a customer
 * needs to choose a cake.
 */
export const menuVariantSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    priceCents: z.number().int(),
    currency: z.string(),
    /**
     * Null means "we do not know", not "yes".
     *
     * Availability is only known once a pickup location is chosen, and offline
     * the app has nothing to go on. A stale menu is survivable; telling somebody
     * a sold-out cake is available, taking their money, and having nothing to
     * hand over is not.
     */
    available: z.boolean().nullable(),
  })
  .strict();

export const menuProductSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    imageUrl: z.string().nullable(),
    /** Allergens are a fixed vocabulary; empty means "not stated", never "free from". */
    allergens: z.array(z.string()),
    dietaryTags: z.array(z.string()),
    /** How far ahead this has to be ordered, and by when on that day. */
    leadTimeDays: z.number().int(),
    orderCutoffTime: z.string(),
    variants: z.array(menuVariantSchema),
  })
  .strict();

export const menuGroupSchema = z
  .object({ category: z.string(), products: z.array(menuProductSchema) })
  .strict();

export const menuResponseSchema = z
  .object({
    locationId: z.string().nullable(),
    groups: z.array(menuGroupSchema),
  })
  .strict();

export type MenuProduct = z.infer<typeof menuProductSchema>;
export type MenuResponse = z.infer<typeof menuResponseSchema>;

/**
 * Make an image path usable by something that is not a browser.
 *
 * Product images may be a Square CDN URL or a path into our own /public — and a
 * path is only meaningful to a client sitting on the same origin. A native app
 * is not, so `<Image src="/harina/ube-bars.webp">` renders nothing at all, which
 * is a menu of grey rectangles.
 *
 * Absolute URLs are left alone. Anything else is resolved against the base the
 * caller supplies.
 */
export function absoluteImageUrl(url: string | null, base: string): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${base.replace(/\/$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function toMenuProduct(
  product: StoreProduct,
  availability: ReadonlyMap<string, boolean> | null,
  base: string,
): MenuProduct {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.descriptionMd ?? product.description,
    /* One image. The app shows a single photo per product and shipping the whole
       array would be bytes nobody renders. */
    imageUrl: absoluteImageUrl(product.heroImageUrl ?? product.imageUrls[0] ?? null, base),
    allergens: product.allergens,
    dietaryTags: product.dietaryTags,
    leadTimeDays: product.rule.leadTimeDays,
    orderCutoffTime: product.rule.orderCutoffTime,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      priceCents: variant.priceCents,
      currency: variant.currency,
      available: availability ? (availability.get(variant.id) ?? false) : null,
    })),
  };
}


/**
 * Pickup shops, for the customer app's location picker.
 *
 * `StoreLocation` also carries currency and an ISO country code, which exist for
 * the digital wallets' payment request. Nothing on a picker screen needs them,
 * so they stay out — the same reasoning as everywhere else here: a field only
 * crosses the wire when somebody decides it should.
 */
export const pickupHoursSchema = z
  .object({ dayOfWeek: z.string(), startTime: z.string(), endTime: z.string() })
  .strict();

export const pickupShopSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    address: z.string(),
    city: z.string().nullable(),
    phone: z.string().nullable(),
    /** For "20 minutes away" later; null where Square has no coordinates. */
    coordinates: z.object({ latitude: z.number(), longitude: z.number() }).strict().nullable(),
    hours: z.array(pickupHoursSchema),
  })
  .strict();

export const pickupShopsResponseSchema = z
  .object({ shops: z.array(pickupShopSchema) })
  .strict();

export type PickupShop = z.infer<typeof pickupShopSchema>;

export function toPickupShop(location: StoreLocation): PickupShop {
  return {
    id: location.id,
    name: location.name,
    address: location.address,
    city: location.city,
    phone: location.phone,
    coordinates: location.coordinates,
    hours: location.businessHours.map((period) => ({
      dayOfWeek: period.dayOfWeek,
      startTime: period.startTime,
      endTime: period.endTime,
    })),
  };
}


/**
 * One order, for the customer who placed it.
 *
 * The narrowest DTO here, because `OrderWithItems` is the rawest thing in the
 * codebase — 43 columns of Square ids, payment attempt keys, refund state and a
 * staff note. A customer needs about a dozen of them.
 */
export const orderItemLineSchema = z
  .object({
    name: z.string(),
    quantity: z.number().int(),
    unitPriceCents: z.number().int(),
    totalPriceCents: z.number().int(),
  })
  .strict();

export const customerOrderSchema = z
  .object({
    orderNumber: z.string(),
    status: z.string(),
    customerName: z.string(),
    pickupDate: z.string(),
    pickupTime: z.string(),
    pickup: z
      .object({
        name: z.string().nullable(),
        address: z.string().nullable(),
        city: z.string().nullable(),
        phone: z.string().nullable(),
      })
      .strict(),
    items: z.array(orderItemLineSchema),
    subtotalCents: z.number().int(),
    taxCents: z.number().int(),
    tipCents: z.number().int(),
    totalCents: z.number().int(),
    currency: z.string(),
    customerNote: z.string().nullable(),
    /**
     * The signed string behind the QR code, or null when there is nothing to
     * collect — unpaid, cancelled, or already handed over.
     *
     * It is a static signature over the order, not a session: it does not
     * expire and needs no network to be useful. That is the whole point. The
     * app stores it when the order is placed and can show it in a shop with no
     * signal, which is exactly the moment somebody needs it.
     */
    pickupPass: z.string().nullable(),
  })
  .strict();

export type CustomerOrder = z.infer<typeof customerOrderSchema>;
