"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { RefreshIcon } from "@/components/ui/icons";

/**
 * Keeps a live order page current.
 *
 * The confirmation page was fully static, so a customer waiting in the car
 * never saw "Ready for pickup" unless they thought to reload — while the staff
 * queue, which drives that very status, polled every 15 seconds. The two views
 * of the same order had opposite freshness models.
 *
 * `router.refresh()` rather than a bespoke status endpoint: the page's data
 * fetch already exists and isn't cached, so re-rendering the server component
 * is both simpler and guaranteed to agree with a hard reload.
 */

const POLL_INTERVAL_MS = 15_000;
const AGE_TICK_MS = 15_000;

export function OrderRefresher({ live }: { live: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  /**
   * The "x ago" label, as a string.
   *
   * Stored rather than derived at render time because reading the clock during
   * render is impure — the same component would produce different output on an
   * unrelated re-render. Both timers below write it from a callback instead.
   */
  const [age, setAge] = useState<string | null>(null);
  const lastUpdatedAt = useRef<number | null>(null);

  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
      lastUpdatedAt.current = Date.now();
      setAge("just now");
    });
  }, [router]);

  // Polling stops once the order reaches a terminal state — there is nothing
  // left to watch on a completed or cancelled order.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [live, refresh]);

  // Ages the label between polls, so "just now" doesn't sit there for a minute.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      const at = lastUpdatedAt.current;
      if (at !== null) setAge(describeAge(Date.now() - at));
    }, AGE_TICK_MS);
    return () => clearInterval(timer);
  }, [live]);

  if (!live) return null;

  return (
    <div className="text-ink-subtle flex flex-wrap items-center gap-3 text-xs">
      <span aria-live="polite">
        {isPending
          ? "Checking for updates…"
          : age
            ? `Updated ${age}`
            : "This page updates automatically."}
      </span>

      <button
        type="button"
        onClick={refresh}
        className="text-ink-muted hover:text-brand inline-flex items-center gap-1.5 underline underline-offset-2 transition-colors"
      >
        <RefreshIcon className="h-3.5 w-3.5" />
        Refresh now
      </button>
    </div>
  );
}

function describeAge(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
}
