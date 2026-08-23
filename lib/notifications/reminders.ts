import "server-only";

import { inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { reportError } from "@/lib/monitoring/report";
import { getSettingFresh } from "@/lib/settings/store";
import { addCalendarDays, storeNowTime, storeToday } from "@/lib/scheduling/time";

import { buildOrderNotification, dispatch } from "./dispatch";
import type { ChannelName } from "./types";

export const PICKUP_REMINDER_SETTING_KEY = "reminders.pickup";

export const pickupReminderSettingSchema = z.object({
  enabled: z.boolean(),
  /** Local hour the reminder window opens at each pickup location. */
  startHour: z.number().int().min(0).max(21),
});

const DEFAULTS = { enabled: true, startHour: 8 };

/** Reminders are customer-facing only; the store already has the order on its queue. */
const REMINDER_CHANNELS: ChannelName[] = ["email_customer", "sms_customer"];

/**
 * Morning-of pickup reminders, driven by the fast maintenance cron.
 *
 * Every product has at least a one-day lead time with an 18:00 cutoff, so a
 * reminder at 08:00 local is always hours after purchase — it's the actionable
 * "today's the day" nudge, not spam. The window is three hours wide
 * (start..start+2:59) so a few missed cron ticks can't skip a morning, and the
 * per-(order, `order_reminder:{pickup_date}`, channel) claim in the dispatcher
 * makes every refire within the window idempotent.
 *
 * Never key this off the daily 08:17 UTC cron — that's 03:17 in Toronto.
 * Timing uses each order's pickup-location timezone snapshot.
 */
export async function sendPickupReminders(now = new Date()): Promise<number> {
  const settings =
    (await getSettingFresh(PICKUP_REMINDER_SETTING_KEY, pickupReminderSettingSchema)) ?? DEFAULTS;
  if (!settings.enabled) return 0;

  const fallbackTimeZone = serverEnv().STORE_TIMEZONE;

  // Cheap pre-filter: local "today" at any location lies within one calendar
  // day of UTC today. The exact timezone check happens per order below.
  const utcToday = storeToday(now, "UTC");
  const candidateDates = [addCalendarDays(utcToday, -1), utcToday, addCalendarDays(utcToday, 1)];

  const candidates = await db()
    .select()
    .from(orders)
    .where(inArray(orders.status, ["paid", "preparing", "ready"]))
    .then((rows) => rows.filter((row) => candidateDates.includes(row.pickupDate)));

  let sent = 0;
  for (const order of candidates) {
    const timeZone = order.pickupLocationTimezone ?? fallbackTimeZone;
    if (order.pickupDate !== storeToday(now, timeZone)) continue;

    const hour = Number.parseInt(storeNowTime(now, timeZone).slice(0, 2), 10);
    if (hour < settings.startHour || hour >= settings.startHour + 3) continue;

    try {
      const notification = await buildOrderNotification(order.id);
      if (!notification) continue;
      await dispatch({
        kind: "order_reminder",
        order: notification,
        dedupeKey: `order_reminder:${order.pickupDate}`,
        channels: REMINDER_CHANNELS,
      });
      sent += 1;
    } catch (cause) {
      reportError("notifications", "pickup reminder dispatch failed", cause, {
        orderNumber: order.orderNumber,
      });
    }
  }
  return sent;
}
