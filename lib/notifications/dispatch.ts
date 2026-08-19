import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { notificationLog, orderItems, orders } from "@/lib/db/schema";
import { normalizeTime } from "@/lib/scheduling/time";

import { CHANNELS } from "./channels";
import type {
  ChannelName,
  ChannelResult,
  NotificationEvent,
  NotificationEventKind,
  OrderNotification,
} from "./types";

/**
 * The notification dispatcher.
 *
 * One event in, every configured channel out. Channels run concurrently and
 * independently: Twilio being down must not stop the Discord post, and neither
 * must stop the email. Every attempt is written to `notification_log`, so
 * "the store says they never got the text" is an answerable question rather than
 * a guess.
 */

/**
 * Send an event to every channel.
 *
 * Never throws. A notification failure must not roll back a paid order — the
 * money has already moved, and the order is safely recorded either way.
 */
export async function dispatch(event: NotificationEvent): Promise<ChannelResult[]> {
  const entries = Object.entries(CHANNELS) as [
    ChannelName,
    (typeof CHANNELS)[ChannelName],
  ][];

  const results = await Promise.all(
    entries.map(async ([name, send]): Promise<ChannelResult> => {
      // Both paths — payForOrder and the payment.updated webhook — can fire the
      // same event for one order. Without this the store gets everything twice.
      if (await alreadySent(event.order.orderId, event.kind, name)) {
        return { channel: name, ok: true, skipped: true };
      }

      try {
        const result = await send(event);
        await record(event, name, result);
        return result;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const result: ChannelResult = { channel: name, ok: false, error: message };
        await record(event, name, result).catch(() => {});
        console.error(`[notifications] ${name} failed for ${event.order.orderNumber}:`, message);
        return result;
      }
    }),
  );

  return results;
}

async function alreadySent(
  orderId: string,
  kind: NotificationEventKind,
  channel: ChannelName,
): Promise<boolean> {
  const [existing] = await db()
    .select({ id: notificationLog.id })
    .from(notificationLog)
    .where(
      and(
        eq(notificationLog.orderId, orderId),
        eq(notificationLog.event, kind),
        eq(notificationLog.channel, channel),
        eq(notificationLog.status, "sent"),
      ),
    )
    .limit(1);

  return Boolean(existing);
}

async function record(
  event: NotificationEvent,
  channel: ChannelName,
  result: ChannelResult,
): Promise<void> {
  // A skipped channel isn't logged as sent — otherwise enabling it later would
  // look like it had already delivered.
  if (result.skipped) return;

  await db().insert(notificationLog).values({
    orderId: event.order.orderId,
    channel,
    event: event.kind,
    status: result.ok ? "sent" : "failed",
    attempts: 1,
    lastError: result.error ?? null,
    sentAt: result.ok ? new Date() : null,
  });
}

/** Load everything the channels need for an order. */
export async function buildOrderNotification(
  orderId: string,
): Promise<OrderNotification | null> {
  const [order] = await db().select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return null;

  const items = await db()
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    pickupDate: order.pickupDate,
    pickupTime: normalizeTime(order.pickupTime),
    totalCents: order.totalCents,
    currency: order.currency,
    items: items.map((item) => ({ quantity: item.quantity, name: item.nameSnapshot })),
    note: order.customerNote,
  };
}

/**
 * Load and dispatch in one call, swallowing every error.
 *
 * Intended to be handed to `after()` so delivery happens once the customer's
 * response is already on its way — nobody should wait on Twilio to see their
 * confirmation page.
 */
export async function notifyOrder(
  orderId: string,
  kind: NotificationEventKind,
): Promise<void> {
  try {
    const order = await buildOrderNotification(orderId);
    if (!order) {
      console.error(`[notifications] no order ${orderId} to notify about`);
      return;
    }
    await dispatch({ kind, order });
  } catch (cause) {
    console.error("[notifications] dispatch failed:", cause);
  }
}
