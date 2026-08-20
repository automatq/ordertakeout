import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while the staff layout's auth check resolves.
 *
 * That check is deliberately blocking (`instant = false` in the layout) so we
 * never stream a staff-looking shell to someone who isn't staff — which means
 * there is a real gap here on a cold navigation, and it deserves a shape rather
 * than a blank screen.
 */
export default function StaffLoading() {
  return (
    <LoadingRegion label="Loading dashboard" className="shell flex flex-col gap-6 py-8">
      <Skeleton className="h-9 w-56" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>
    </LoadingRegion>
  );
}
