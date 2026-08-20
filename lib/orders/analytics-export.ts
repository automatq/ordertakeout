interface ExportPoint {
  date: string;
  revenueCents: number;
  orderCount: number;
}

export interface AnalyticsCsvInput {
  currency: string;
  byDay: readonly ExportPoint[];
  previousByDay: readonly ExportPoint[];
}

/** Exact chart data in a spreadsheet-friendly, comparison-aligned CSV. */
export function salesAnalyticsCsv(data: AnalyticsCsvInput): string {
  const rows = [
    [
      "pickup_date",
      "orders",
      "revenue",
      "currency",
      "previous_pickup_date",
      "previous_orders",
      "previous_revenue",
    ],
    ...data.byDay.map((point, index) => {
      const previous = data.previousByDay[index];
      return [
        point.date,
        String(point.orderCount),
        moneyDecimal(point.revenueCents),
        data.currency,
        previous?.date ?? "",
        String(previous?.orderCount ?? 0),
        moneyDecimal(previous?.revenueCents ?? 0),
      ];
    }),
  ];

  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

const moneyDecimal = (cents: number): string => (cents / 100).toFixed(2);

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
