import { connection } from "next/server";
import { Suspense } from "react";

import { SalesAnalytics } from "@/components/staff/sales-analytics";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { getSalesAnalytics, parseRange } from "@/lib/orders/analytics";
import { getStoreLocationsSafe } from "@/lib/locations/server";

export const metadata = { title: "Sales — Staff" };

type PageProps = { searchParams: Promise<{ range?: string; location?: string }> };

export default function SalesAnalyticsPage({ searchParams }: PageProps) {
  return (
    <div className="shell py-8">
      <Suspense fallback={<ReportSkeleton />}>
        <Report searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Report({ searchParams }: PageProps) {
  // Aggregates over live order data: render at request time, never prerender.
  await connection();

  const { range, location: requestedLocationId } = await searchParams;
  const locations = await getStoreLocationsSafe();
  const locationId = locations.some((location) => location.id === requestedLocationId)
    ? requestedLocationId
    : undefined;
  const data = await getSalesAnalytics(parseRange(range), locationId);
  return <SalesAnalytics data={data} locations={locations} locationId={locationId} />;
}

function ReportSkeleton() {
  return (
    <LoadingRegion label="Loading sales" className="flex flex-col gap-8">
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
    </LoadingRegion>
  );
}
