import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, lt, lte, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { notificationLog, orderItems, orderRefunds, orders } from "@/lib/db/schema";
import { reportError } from "@/lib/monitoring/report";
import { normalizeTime } from "@/lib/scheduling/time";
import { orderTrackingUrl } from "@/lib/orders/access";

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
    Exclude<ChannelName, "email">,
    (typeof CHANNELS)[Exclude<ChannelName, "email">],
  ][];

  const dedupeKey = event.dedupeKey ?? event.kind;
  const results = await Promise.all(
    entries.map(async ([name, send]): Promise<ChannelResult> => {
      if (event.channels && !event.channels.includes(name)) {
        return { channel: name, ok: true, skipped: true };
      }
      // Claim the unique delivery before touching the provider. This closes the
      // old check-then-send race between checkout and Square's payment webhook.
      if (!(await claim(event.order.orderId, dedupeKey, name))) {
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
        reportError("notifications", `${name} delivery failed`, cause, {
          orderNumber: event.order.orderNumber,
        });
        return result;
      }
    }),
  );

  return results;
}

async function claim(
  orderId: string,
  dedupeKey: string,
  channel: ChannelName,
): Promise<boolean> {
  const rows = await db().execute<{ id: string }>(sql`
    INSERT INTO ${notificationLog} (order_id, channel, event, status, attempts, created_at)
    VALUES (${orderId}, ${channel}::notification_channel, ${dedupeKey}, 'pending', 1, now())
    ON CONFLICT (order_id, event, channel) DO UPDATE
      SET status = 'pending',
          attempts = ${notificationLog.attempts} + 1,
          last_error = NULL,
          next_attempt_at = NULL
      WHERE (
          (${notificationLog.status} = 'failed'
            AND (${notificationLog.nextAttemptAt} IS NULL OR ${notificationLog.nextAttemptAt} <= now()))
          OR (${notificationLog.status} = 'pending'
            AND ${notificationLog.createdAt} <= now() - interval '15 minutes')
        )
        AND ${notificationLog.attempts} < 5
    RETURNING id
  `);
  return rows.length > 0;
}

async function record(
  event: NotificationEvent,
  channel: ChannelName,
  result: ChannelResult,
): Promise<void> {
  const delivery = and(
    eq(notificationLog.orderId, event.order.orderId),
    eq(notificationLog.event, event.dedupeKey ?? event.kind),
    eq(notificationLog.channel, channel),
  );

  // A disabled channel should be eligible as soon as configuration is added.
  if (result.skipped) {
    await db().delete(notificationLog).where(delivery);
    return;
  }

  await db()
    .update(notificationLog)
    .set({
      status: result.ok ? "sent" : "failed",
      lastError: result.error ?? null,
      sentAt: result.ok ? new Date() : null,
      nextAttemptAt: result.ok ? null : new Date(Date.now() + 5 * 60_000),
    })
    .where(delivery);
}

/** Retry due deliveries. Safe to call from a cron; `claim` enforces idempotency. */
export async function retryFailedNotifications(limit = 50): Promise<number> {
  const due = await db()
    .select({ orderId: notificationLog.orderId, event: notificationLog.event })
    .from(notificationLog)
    .where(
      and(
        or(
          and(eq(notificationLog.status, "failed"), lte(notificationLog.nextAttemptAt, new Date())),
          and(eq(notificationLog.status, "pending"), lt(notificationLog.createdAt, new Date(Date.now() - 15 * 60_000))),
        ),
        sql`${notificationLog.attempts} < 5`,
      ),
    )
    .limit(limit);

  const unique = [...new Map(due.map((entry) => [`${entry.orderId}:${entry.event}`, entry])).values()];
  for (const entry of unique) {
    // The event column stores the dedupe key; the kind is its prefix
    // (e.g. "order_refunded:<refundId>").
    const kind = entry.event.split(":")[0] ?? entry.event;
    if (kind === "order_refunded") {
      const refundId = entry.event.slice("order_refunded:".length);
      if (refundId) await notifyOrderRefund(entry.orderId, refundId);
      continue;
    }
    if (isNotificationKind(kind)) await notifyOrder(entry.orderId, kind);
  }
  return unique.length;
}

function isNotificationKind(value: string): value is NotificationEventKind {
  return value === "order_paid" || value === "order_ready" || value === "order_canceled";
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
    pickupLocationName: order.pickupLocationName,
    pickupLocationId: order.squareLocationId,
    pickupLocationAddress: order.pickupLocationAddress,
    totalCents: order.totalCents,
    currency: order.currency,
    items: items.map((item) => ({ quantity: item.quantity, name: item.nameSnapshot })),
    note: order.customerNote,
    trackingUrl: orderTrackingUrl(order.id, order.orderNumber),
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
      reportError("notifications", "no order to notify about", undefined, { orderId });
      return;
    }
    await dispatch({ kind, order });
  } catch (cause) {
    reportError("notifications", "dispatch failed", cause);
  }
}

/**
 * Staff-triggered re-send of the customer's confirmation email.
 *
 * Each click is its own dedupe unit (random suffix), capped at three per
 * 24 hours so a wrong address can't be hammered; only the customer email
 * channel fires — the store was already notified the first time.
 */
export async function resendCustomerConfirmation(
  orderId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [order] = await db().select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return { ok: false, reason: "Order not found." };
  if (!["paid", "preparing", "ready", "completed"].includes(order.status)) {
    return { ok: false, reason: "Only paid orders can have their confirmation re-sent." };
  }
  if (order.customerEmail === "deleted@invalid.example") {
    return { ok: false, reason: "This order's customer details were anonymized under the retention policy." };
  }

  const [countRow] = await db()
    .select({ count: sql<string>`count(*)` })
    .from(notificationLog)
    .where(and(
      eq(notificationLog.orderId, orderId),
      sql`${notificationLog.event} LIKE 'order_paid_resend:%'`,
      sql`${notificationLog.createdAt} > now() - interval '24 hours'`,
    ));
  if (Number(countRow?.count ?? 0) >= 3) {
    return { ok: false, reason: "Already re-sent three times today. Confirm the email address with the customer instead." };
  }

  const notification = await buildOrderNotification(orderId);
  if (!notification) return { ok: false, reason: "Order not found." };

  const results = await dispatch({
    kind: "order_paid",
    order: notification,
    dedupeKey: `order_paid_resend:${randomUUID().slice(0, 8)}`,
    channels: ["email_customer"],
  });
  const email = results.find((result) => result.channel === "email_customer");
  if (!email || email.skipped) {
    return { ok: false, reason: "Customer email isn't configured on this deployment." };
  }
  if (!email.ok) {
    return { ok: false, reason: `The email didn't send: ${email.error ?? "unknown error"}.` };
  }
  return { ok: true };
}

/**
 * Notify about one completed refund from the ledger.
 *
 * The amount is re-read from order_refunds rather than passed by the caller so
 * cron retries reconstruct the identical event; the per-refund dedupe key means
 * a second partial refund still notifies while replays of the same one don't.
 */
export async function notifyOrderRefund(orderId: string, refundId: string): Promise<void> {
  try {
    const [refund] = await db()
      .select({
        amountCents: orderRefunds.amountCents,
        status: orderRefunds.status,
      })
      .from(orderRefunds)
      .where(eq(orderRefunds.id, refundId))
      .limit(1);
    if (!refund || refund.status !== "completed") return;

    const order = await buildOrderNotification(orderId);
    if (!order) {
      reportError("notifications", "no order to notify about", undefined, { orderId });
      return;
    }
    await dispatch({
      kind: "order_refunded",
      order,
      dedupeKey: `order_refunded:${refundId}`,
      refund: {
        amountCents: refund.amountCents,
        partial: refund.amountCents < order.totalCents,
      },
    });
  } catch (cause) {
    reportError("notifications", "refund dispatch failed", cause);
  }
}
