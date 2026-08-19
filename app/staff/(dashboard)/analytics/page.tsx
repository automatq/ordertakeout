import { connection } from "next/server";
import { Suspense } from "react";

import { SalesAnalytics } from "@/components/staff/sales-analytics";
import { getSalesAnalytics, parseRange } from "@/lib/orders/analytics";

export const metadata = { title: "Sales — Staff" };

type PageProps = { searchParams: Promise<{ range?: string }> };

export default function SalesAnalyticsPage({ searchParams }: PageProps) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Suspense fallback={<p className="text-ink-muted text-sm">Loading sales…</p>}>
        <Report searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Report({ searchParams }: PageProps) {
  // Aggregates over live order data: render at request time, never prerender.
  await connection();

  const { range } = await searchParams;
  const data = await getSalesAnalytics(parseRange(range));
  return <SalesAnalytics data={data} />;
}
