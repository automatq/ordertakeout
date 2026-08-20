"use client";

import Link from "next/link";

import { ArrowLeftIcon, PrinterIcon } from "@/components/ui/icons";
import { addCalendarDays, formatStoreDate } from "@/lib/scheduling/time";

/**
 * Print sheet controls.
 *
 * The prep sheet had none. It was reachable only from the "Print prep sheet"
 * link on a day that happened to have orders, and once there the only way to
 * actually print it was for the user to find their browser's own print command
 * — with no way back to the dashboard and no way to reach yesterday or tomorrow.
 *
 * `print:hidden` on the wrapper, plus the blanket rule in globals.css that hides
 * `.btn` and `nav` in print, keeps all of this off the paper.
 */
export function PrintControls({ date, locationId }: { date: string; locationId: string }) {
  const previous = addCalendarDays(date, -1);
  const next = addCalendarDays(date, 1);

  return (
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      <Link href="/staff" className="btn btn-ghost btn-sm">
        <ArrowLeftIcon className="h-4 w-4" />
        Back to orders
      </Link>

      <div className="ml-auto flex items-center gap-2">
        <Link
          href={`/staff/print/${previous}?location=${encodeURIComponent(locationId)}`}
          className="btn btn-secondary btn-sm"
          aria-label={`Prep sheet for ${formatStoreDate(previous, "long")}`}
        >
          &larr; Prev
        </Link>
        <Link
          href={`/staff/print/${next}?location=${encodeURIComponent(locationId)}`}
          className="btn btn-secondary btn-sm"
          aria-label={`Prep sheet for ${formatStoreDate(next, "long")}`}
        >
          Next &rarr;
        </Link>
        <button type="button" onClick={() => window.print()} className="btn btn-primary btn-sm">
          <PrinterIcon className="h-4 w-4" />
          Print
        </button>
      </div>
    </div>
  );
}
