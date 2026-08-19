import { connection } from "next/server";
import { Suspense } from "react";

import { PrepTimeline } from "@/components/staff/prep-timeline";
import { getDashboardData } from "@/lib/orders/dashboard";

export const metadata = { title: "Prep timeline — Staff" };

export default function PrepTimelinePage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Suspense fallback={<p className="text-ink-muted text-sm">Loading timeline…</p>}>
        <Timeline />
      </Suspense>
    </div>
  );
}

async function Timeline() {
  // A live kitchen screen: stop prerendering and render at request time.
  await connection();

  // Not cached: the kitchen screen must never show a stale order.
  const data = await getDashboardData();
  return <PrepTimeline data={data} />;
}
