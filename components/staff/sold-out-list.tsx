"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { remove86Action } from "@/app/actions/admin";
import { useToast } from "@/components/ui/toast";

export interface SoldOutEntry {
  id: string;
  productName: string;
  locationName: string;
  date: string;
  reason: string | null;
  createdBy: string | null;
}

/** Upcoming "sold out today" entries. They expire on their own; this list is for
 * seeing what's blocked and lifting a block early. */
export function SoldOutList({ entries }: { entries: SoldOutEntry[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  if (entries.length === 0) {
    return (
      <p className="text-ink-muted text-sm">
        Nothing is 86ed. Use &ldquo;86 an item&rdquo; on the orders screen when something
        sells out for the day.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => (
        <li key={entry.id} className="panel flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
          <div className="min-w-0">
            <p className="text-ink font-semibold">
              {entry.productName} &middot; {entry.date}
            </p>
            <p className="text-ink-muted">
              {entry.locationName}
              {entry.reason ? ` · ${entry.reason}` : ""}
              {entry.createdBy ? ` · by ${entry.createdBy}` : ""}
            </p>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await remove86Action({ id: entry.id });
                if (!result.ok) {
                  toast({ message: result.error, tone: "error" });
                  return;
                }
                toast({ message: "Back on sale for that day." });
                router.refresh();
              })
            }
            className="btn btn-secondary btn-sm shrink-0"
          >
            Put back on sale
          </button>
        </li>
      ))}
    </ul>
  );
}
