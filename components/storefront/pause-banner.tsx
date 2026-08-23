import { connection } from "next/server";

import { getPauseState } from "@/lib/settings/pause";

/**
 * Storefront notice while online ordering is paused.
 *
 * Reads the cached global pause (the location-specific switch still hard-blocks
 * at checkout with the same wording — this banner just saves customers from
 * building a cart first). Renders nothing when ordering is open, which is the
 * overwhelmingly common case.
 */
export async function PauseBanner() {
  await connection();
  const pause = await getPauseState(null);
  if (!pause) return null;

  return (
    <div role="status" className="bg-accent-soft border-border border-b px-6 py-3">
      <p className="text-ink mx-auto max-w-6xl text-center text-sm font-medium">
        Online ordering is paused right now{pause.note ? ` — ${pause.note}` : ""}.
        {pause.resumeAt
          ? ` We expect to reopen around ${new Date(pause.resumeAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
          : " Please check back soon or call the store."}
      </p>
    </div>
  );
}
