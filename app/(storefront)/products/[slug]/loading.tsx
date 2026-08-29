import Link from "next/link";

import { ArrowLeftIcon } from "@/components/ui/icons";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";

/**
 * Cold-navigation fallback for the product page. The page resolves the slug in
 * its body (so unknown slugs get a real HTTP 404), which means there is no
 * static shell to stream — this boundary renders the breadcrumb and skeleton
 * that the in-page <Suspense> used to provide.
 */
export default function ProductLoading() {
  return (
    <main className="shell flex flex-col gap-12 py-8 sm:py-12 lg:gap-16 lg:py-16">
      <nav aria-label="Breadcrumb">
        <Link
          href="/#order"
          className="border-brand/25 bg-surface text-brand hover:bg-brand hover:text-brand-ink inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-4 text-sm font-medium transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          All products
        </Link>
      </nav>

      <LoadingRegion
        label="Loading product"
        className="grid gap-8 lg:grid-cols-[1.08fr_0.92fr] lg:items-start lg:gap-12"
      >
        <div className="border-surface shadow-raised overflow-hidden rounded-[2.5rem] border-8">
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
        </div>
        <div className="flex flex-col gap-6">
          <div className="bg-brand flex flex-col gap-4 rounded-[2.25rem] p-6 sm:p-8">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-16 w-3/4" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </div>
          <Skeleton className="h-44 w-full rounded-[2rem]" />
          <Skeleton className="h-72 w-full rounded-[2rem]" />
        </div>
      </LoadingRegion>
    </main>
  );
}
