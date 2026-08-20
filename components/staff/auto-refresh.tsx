"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";

import { RefreshIcon } from "@/components/ui/icons";

/**
 * Keeps a server-rendered staff screen current.
 *
 * The prep timeline and the closed-orders list are server components with no
 * controls, which is the right call — neither needs a client bundle for its
 * content. But it meant they rendered once and then went stale, while the order
 * queue that drives their data polled every fifteen seconds. A wall-mounted
 * "what do I bake next" board that's wrong by lunchtime is worse than no board.
 *
 * This is the smallest thing that fixes it: a client island that calls
 * `router.refresh()` on a timer. The page stays a server component; only this
 * button ships JavaScript.
 */

const REFRESH_INTERVAL_MS = 60_000;

export function AutoRefresh({ className }: { className?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [paused, setPaused] = useState(false);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [paused, refresh]);

  return (
    <div className={`flex items-center gap-3 print:hidden ${className ?? ""}`}>
      <button
        type="button"
        onClick={refresh}
        className="text-ink-muted hover:text-brand inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <RefreshIcon className={`h-4 w-4 ${isPending ? "animate-spin-slow" : ""}`} />
        {isPending ? "Refreshing…" : "Refresh"}
      </button>

      {/* An escape hatch for the one case auto-refresh is hostile: a staff
          member reading a long note when the screen re-renders under them. */}
      <label className="text-ink-subtle flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          checked={!paused}
          onChange={(event) => setPaused(!event.target.checked)}
          className="accent-brand"
        />
        Auto
      </label>
    </div>
  );
}
