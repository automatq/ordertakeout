import { connection } from "next/server";
import { Suspense } from "react";

import { OrderQueue } from "@/components/staff/order-queue";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { getOrderableProducts } from "@/lib/catalog/server";
import { serverEnv } from "@/lib/env";
import { getDashboardData } from "@/lib/orders/dashboard";

export const metadata = { title: "Orders — Staff" };

export default function StaffDashboardPage() {
  return (
    <div className="shell py-8">
      <Suspense fallback={<QueueSkeleton />}>
        <Queue />
      </Suspense>
    </div>
  );
}

async function Queue() {
  // A live kitchen screen: stop prerendering and render at request time.
  await connection();

  // Not cached: the kitchen screen must never show a stale order.
  const [data, catalog] = await Promise.all([getDashboardData(), getOrderableProducts()]);
  return (
    <OrderQueue
      initialData={data}
      timeZone={serverEnv().STORE_TIMEZONE}
      products={catalog.products.map((product) => ({ id: product.id, name: product.name }))}
    />
  );
}

/** Shaped like the real queue, so the page doesn't jump when orders land. */
function QueueSkeleton() {
  return (
    <LoadingRegion label="Loading orders" className="flex flex-col gap-6">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-5 w-40" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-36 w-full" />
        ))}
      </div>
    </LoadingRegion>
  );
}
