import { LoadingRegion, ProductGridSkeleton, Skeleton } from "@/components/ui/skeleton";

/** Route-level fallback for customer navigations that wait on live order data. */
export default function StorefrontLoading() {
  return (
    <LoadingRegion label="Loading page" className="shell flex flex-col gap-8 py-section">
      <Skeleton className="h-5 w-28" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-12 w-full max-w-xl" />
        <Skeleton className="h-5 w-full max-w-2xl" />
      </div>
      <ProductGridSkeleton />
    </LoadingRegion>
  );
}
