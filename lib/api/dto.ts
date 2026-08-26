import { z } from "zod";

import { summariseProduction } from "@/lib/orders/dashboard";
import type { DashboardData, DashboardOrder } from "@/lib/orders/dashboard";
import type { PickupVerificationPreview } from "@/lib/orders/pickup-verification";
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
