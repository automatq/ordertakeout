import "server-only";

import { formatInTimeZone } from "date-fns-tz";

import { serverEnv } from "@/lib/env";

import { searchClosedOrders, type ClosedOrderQuery } from "./dashboard";

/**
 * CSV of the closed-orders screen's current filter — the "how many did we
 * cancel in March, and who were they" question, answerable outside the app.
 * Order-level rows (item summary in one column); the accounting export remains
 * the financial source.
 */

export const CLOSED_EXPORT_MAX_ROWS = 5000;

export type ClosedExportResult =
  | { ok: true; csv: string }
  | { ok: false; reason: "too_many_rows" };

export async function closedOrdersCsv(query: ClosedOrderQuery): Promise<ClosedExportResult> {
  const rows = await searchClosedOrders({
    ...query,
    limit: CLOSED_EXPORT_MAX_ROWS + 1,
    offset: 0,
  });
  if (rows.length > CLOSED_EXPORT_MAX_ROWS) return { ok: false, reason: "too_many_rows" };

  const defaultTimeZone = serverEnv().STORE_TIMEZONE;
  const header = [
    "order_number",
    "status",
    "pickup_date",
    "pickup_time",
    "location",
    "customer_name",
    "customer_phone",
    "items",
    "total",
    "refunded_total",
    "currency",
    "verified_by",
    "verified_at",
    "closed_at",
  ];

  const lines = rows.map((order) => {
    const timeZone = order.pickupLocationTimezone ?? defaultTimeZone;
    const closedAt = order.status === "canceled" ? order.canceledAt : order.completedAt;
    return [
      order.orderNumber,
      order.status,
      order.pickupDate,
      order.pickupTime,
      order.pickupLocationName ?? "",
      order.customerName,
      order.customerPhone,
      order.items.map((item) => `${item.quantity}x ${item.nameSnapshot}`).join("; "),
      (order.totalCents / 100).toFixed(2),
      (order.refundedTotalCents / 100).toFixed(2),
      order.currency,
      order.pickupVerification?.staffInitials ?? "",
      order.pickupVerification
        ? formatInTimeZone(order.pickupVerification.verifiedAt, timeZone, "yyyy-MM-dd HH:mm")
        : "",
      closedAt ? formatInTimeZone(closedAt, timeZone, "yyyy-MM-dd HH:mm") : "",
    ];
  });

  return {
    ok: true,
    csv: `${[header, ...lines].map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`,
  };
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
