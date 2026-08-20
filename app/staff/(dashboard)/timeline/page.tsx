import { connection } from "next/server";
import { Suspense } from "react";

import { PrepTimeline } from "@/components/staff/prep-timeline";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { getDashboardData } from "@/lib/orders/dashboard";
import { getStoreLocationsSafe } from "@/lib/locations/server";
import { serverEnv } from "@/lib/env";
import { storeNowTime } from "@/lib/scheduling/time";

export const metadata = { title: "Prep timeline — Staff" };

type PageProps = { searchParams: Promise<{ location?: string }> };

export default function PrepTimelinePage({ searchParams }: PageProps) {
  return (
    <div className="shell py-8">
      <Suspense fallback={<TimelineSkeleton />}>
        <Timeline searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Timeline({ searchParams }: PageProps) {
  // A live kitchen screen: stop prerendering and render at request time.
  await connection();

  // Not cached: the kitchen screen must never show a stale order.
  const { location: requestedLocationId } = await searchParams;
  const locations = await getStoreLocationsSafe();
  const locationId = locations.some((location) => location.id === requestedLocationId)
    ? requestedLocationId
    : undefined;
  const data = await getDashboardData(7, locationId);
  const timeZone = locations.find((location) => location.id === locationId)?.timezone
    ?? serverEnv().STORE_TIMEZONE;
  return (
    <div className="flex flex-col gap-5">
      <form method="get" className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-subtle font-medium">Location</span>
          <select name="location" defaultValue={locationId ?? ""} className="input">
            <option value="">All locations</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </label>
        <button className="btn btn-secondary btn-sm" type="submit">Apply</button>
      </form>
      <PrepTimeline data={data} nowTime={storeNowTime(new Date(), timeZone)} />
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <LoadingRegion label="Loading prep timeline" className="flex flex-col gap-6">
      <Skeleton className="h-9 w-56" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-72 w-72 shrink-0" />
        ))}
      </div>
    </LoadingRegion>
  );
}
