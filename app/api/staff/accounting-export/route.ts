import { hasStaffSession } from "@/lib/auth/guard";
import {
  accountingTransactionsCsv,
  getAccountingTransactions,
  parseAccountingExportFilter,
} from "@/lib/orders/accounting-export";

/** Download a vendor-neutral, financial-event CSV for an accountant to map. */
export async function GET(request: Request) {
  if (!(await hasStaffSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const filter = parseAccountingExportFilter({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    location: url.searchParams.get("location"),
  });
  if (!filter) {
    return Response.json({ error: "Choose a valid date range of up to 366 days." }, { status: 400 });
  }

  const csv = accountingTransactionsCsv(await getAccountingTransactions(filter));
  const filename = `harina-accounting-${filter.from}-to-${filter.to}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
