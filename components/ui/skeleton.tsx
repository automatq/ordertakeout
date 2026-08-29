/**
 * Loading placeholders.
 *
 * Every Suspense boundary in the app used to fall back to the string
 * "Loading…", which tells the reader nothing about what is coming and collapses
 * the layout the moment it resolves. These stand in at roughly the shape of the
 * real content instead, so the page doesn't jump.
 *
 * The wrappers carry `role="status"` with an `sr-only` label: the shimmer is a
 * purely visual cue, and a screen reader otherwise hears silence during the
 * wait. The decorative blocks inside stay `aria-hidden`.
 */

export function Skeleton({ className }: { className: string }) {
  return <span aria-hidden className={`skeleton block ${className}`} />;
}

/** Wraps a set of skeleton blocks and announces the wait exactly once. */
export function LoadingRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** A grid of product tiles, matching <ProductCard/>'s proportions. */
export function ProductGridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <LoadingRegion
      label="Loading products"
      className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="card overflow-hidden">
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="flex flex-col gap-3 p-5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="mt-2 h-6 w-24" />
          </div>
        </div>
      ))}
    </LoadingRegion>
  );
}

/** A stack of line rows — the cart, the checkout summary, a closed-orders list. */
export function ListSkeleton({
  label,
  rows = 3,
}: {
  label: string;
  rows?: number;
}) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="card flex items-center gap-4 p-4">
          <Skeleton className="h-14 w-14 shrink-0 rounded-control" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-6 w-16 shrink-0" />
        </div>
      ))}
    </LoadingRegion>
  );
}

/** A form panel — checkout details, staff settings. */
export function FormSkeleton({ label, fields = 4 }: { label: string; fields?: number }) {
  return (
    <LoadingRegion label={label} className="card flex flex-col gap-4 p-6">
      {Array.from({ length: fields }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-11 w-full" />
        </div>
      ))}
      <Skeleton className="mt-2 h-11 w-40" />
    </LoadingRegion>
  );
}
