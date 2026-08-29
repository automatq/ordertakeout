import { hasStaffSession } from "@/lib/auth/guard";
import { closedOrdersCsv, CLOSED_EXPORT_MAX_ROWS } from "@/lib/orders/closed-export";
import { isStoreDate } from "@/lib/scheduling/time";

/** Download the closed-orders screen's current filter as a CSV. */
export async function GET(request: Request) {
  if (!(await hasStaffSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const result = await closedOrdersCsv({
    search: url.searchParams.get("q") ?? undefined,
    status: status === "completed" || status === "canceled" ? status : undefined,
    from: from && isStoreDate(from) ? from : undefined,
    to: to && isStoreDate(to) ? to : undefined,
    locationId: url.searchParams.get("location") ?? undefined,
  });

  if (!result.ok) {
    return Response.json(
      { error: `More than ${CLOSED_EXPORT_MAX_ROWS} rows match. Narrow the date range and try again.` },
      { status: 400 },
    );
  }

  return new Response(result.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="harina-closed-orders.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
