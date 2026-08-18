import { connection } from "next/server";
import { Suspense } from "react";

import { OrderQueue } from "@/components/staff/order-queue";
import { getDashboardData } from "@/lib/orders/dashboard";

export const metadata = { title: "Orders — Staff" };

export default function StaffDashboardPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Suspense fallback={<p className="text-ink-muted text-sm">Loading orders…</p>}>
        <Queue />
      </Suspense>
    </div>
  );
}

async function Queue() {
  // A live kitchen screen: stop prerendering and render at request time.
  await connection();

  // Not cached: the kitchen screen must never show a stale order.
  const data = await getDashboardData();
  return <OrderQueue initialData={data} />;
}
