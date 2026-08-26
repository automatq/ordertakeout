import { z } from "zod";

import type { DashboardData, DashboardOrder } from "@/lib/orders/dashboard";

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
    pickupTime: order.pickupTime,
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
      slots: day.slots.map((slot) => ({
        time: slot.time,
        capacity: slot.capacity,
        orders: slot.orders.map(toQueueOrder),
      })),
    })),
  };
}
