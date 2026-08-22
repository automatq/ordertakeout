import "server-only";

import { and, eq, gte, inArray, isNotNull, lt, or } from "drizzle-orm";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { addCalendarDays, assertStoreDate, daysBetween, type StoreDate } from "@/lib/scheduling/time";

const PAID_STATUSES = ["paid", "preparing", "ready", "completed"] as const;
const MAX_EXPORT_DAYS = 366;

export interface AccountingExportFilter {
  from: StoreDate;
  to: StoreDate;
  locationId?: string;
}

export interface AccountingTransaction {
  transactionType: "payment" | "refund";
  transactionDate: string;
  transactionId: string;
  orderNumber: string;
  squareOrderId: string | null;
  squarePaymentId: string | null;
  squareRefundId: string | null;
  locationId: string | null;
  locationName: string | null;
  currency: string;
  netSalesCents: number;
  taxCents: number;
  grossCents: number;
  refundCents: number;
}

/** Validate the bounded, calendar-date range used by the staff CSV endpoint. */
export function parseAccountingExportFilter(input: {
  from: string | null;
  to: string | null;
  location: string | null;
}): AccountingExportFilter | null {
  if (!input.from || !input.to) return null;
  try {
    const from = assertStoreDate(input.from);
    const to = assertStoreDate(input.to);
    if (!isRealCalendarDate(from) || !isRealCalendarDate(to)) return null;
    const span = daysBetween(from, to);
    if (span < 0 || span > MAX_EXPORT_DAYS) return null;
    return { from, to, ...(input.location ? { locationId: input.location } : {}) };
  } catch {
    return null;
  }
}

/**
 * Financial-event export, deliberately not a journal entry export.
 *
 * Every accounting package can import a CSV, but account names and tax-code
 * mappings are business-specific. This gives accountants source amounts and
 * immutable Square references without guessing a chart of accounts or creating
 * duplicate payments next to Square's own accounting connection.
 */
export function accountingTransactionsCsv(transactions: readonly AccountingTransaction[]): string {
  const header = [
    "transaction_type",
    "transaction_date",
    "transaction_id",
    "order_number",
    "square_order_id",
    "square_payment_id",
    "square_refund_id",
    "location_id",
    "location_name",
    "currency",
    "net_sales",
    "tax",
    "gross_amount",
    "refund_amount",
    "fee_source",
  ];
  const rows = transactions.map((transaction) => [
    transaction.transactionType,
    transaction.transactionDate,
    transaction.transactionId,
    transaction.orderNumber,
    transaction.squareOrderId ?? "",
    transaction.squarePaymentId ?? "",
    transaction.squareRefundId ?? "",
    transaction.locationId ?? "",
    transaction.locationName ?? "",
    transaction.currency,
    moneyDecimal(transaction.netSalesCents),
    moneyDecimal(transaction.taxCents),
    moneyDecimal(transaction.grossCents),
    moneyDecimal(transaction.refundCents),
    "Import Square processing fees from Square payout data",
  ]);
  return `${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** Fetch paid sales and completed refunds by their accounting event date. */
export async function getAccountingTransactions(
  filter: AccountingExportFilter,
): Promise<AccountingTransaction[]> {
  const defaultTimeZone = serverEnv().STORE_TIMEZONE;
  // The report date is local to the location that took the payment. Query the
  // widest possible timezone envelope, then apply each order's stored timezone
  // below. A single server-timezone interval would lose late-night payments at
  // branches west of the fallback timezone (or add an east-coast payment to
  // the following report date).
  const start = fromZonedTime(`${filter.from}T00:00:00`, "Pacific/Kiritimati");
  const end = fromZonedTime(`${addCalendarDays(filter.to, 1)}T00:00:00`, "Etc/GMT+12");
  const location = filter.locationId ? eq(orders.squareLocationId, filter.locationId) : undefined;
  const rows = await db()
    .select()
    .from(orders)
    .where(and(
      location,
      or(
        and(
          inArray(orders.status, [...PAID_STATUSES]),
          isNotNull(orders.paidAt),
          gte(orders.paidAt, start),
          lt(orders.paidAt, end),
        ),
        and(
          eq(orders.status, "canceled"),
          eq(orders.refundStatus, "completed"),
          isNotNull(orders.canceledAt),
          gte(orders.canceledAt, start),
          lt(orders.canceledAt, end),
        ),
      ),
    ));

  return rows
    .map((order): AccountingTransaction | null => {
      const isRefund = order.status === "canceled" && order.refundStatus === "completed";
      const occurredAt = isRefund ? order.canceledAt : order.paidAt;
      if (!occurredAt) return null;
      const timeZone = order.pickupLocationTimezone ?? defaultTimeZone;
      const reference = isRefund
        ? order.squareRefundId ?? order.id
        : order.squarePaymentId ?? order.squareOrderId ?? order.id;
      const sign = isRefund ? -1 : 1;
      const transactionDate = formatInTimeZone(occurredAt, timeZone, "yyyy-MM-dd");
      if (transactionDate < filter.from || transactionDate > filter.to) return null;
      return {
        transactionType: isRefund ? "refund" : "payment",
        transactionDate,
        transactionId: `${isRefund ? "refund" : "payment"}:${reference}`,
        orderNumber: order.orderNumber,
        squareOrderId: order.squareOrderId,
        squarePaymentId: order.squarePaymentId,
        squareRefundId: order.squareRefundId,
        locationId: order.squareLocationId,
        locationName: order.pickupLocationName,
        currency: order.currency,
        netSalesCents: sign * order.subtotalCents,
        taxCents: sign * order.taxCents,
        grossCents: sign * order.totalCents,
        refundCents: isRefund ? order.totalCents : 0,
      };
    })
    .filter((transaction): transaction is AccountingTransaction => transaction !== null)
    .sort((left, right) => left.transactionDate.localeCompare(right.transactionDate)
      || left.transactionId.localeCompare(right.transactionId));
}

const moneyDecimal = (cents: number): string => (cents / 100).toFixed(2);

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function isRealCalendarDate(date: StoreDate): boolean {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}
