"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Staff navigation.
 *
 * Every link used to render identically on every route — no `aria-current`, no
 * active styling — so the only clue you were on Settings rather than Sales was
 * the page heading. On a wall tablet that someone else last touched, that's a
 * real cost.
 *
 * The nav scrolls horizontally rather than wrapping: five items plus a sign-out
 * button collided at tablet widths, and a wrapped nav pushes the queue further
 * down a screen that is already short on vertical room.
 */

const LINKS = [
  { href: "/staff", label: "Orders" },
  { href: "/staff/timeline", label: "Timeline" },
  { href: "/staff/analytics", label: "Sales" },
  { href: "/staff/closed", label: "Completed" },
  { href: "/staff/settings", label: "Settings" },
] as const;

export function StaffNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Staff" className="scroll-row min-w-0 gap-1">
      {LINKS.map((link) => {
        // "/staff" is a prefix of every other route, so it has to match exactly.
        const active =
          link.href === "/staff" ? pathname === "/staff" : pathname.startsWith(link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-control px-3 py-2 text-sm whitespace-nowrap transition-colors ${
              active
                ? "bg-brand-soft text-brand-deep font-medium"
                : "text-ink-muted hover:bg-surface-sunken hover:text-ink"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The wall clock.
 *
 * Pickup slots are wall-clock times, and the tablet's own clock is usually
 * hidden behind the browser in kiosk mode — so "is 4 PM close?" was a question
 * the dashboard couldn't answer.
 *
 * Formatted in the STORE's timezone, not the device's. Every time in this app —
 * cutoffs, slots, prep sheets — is store wall-clock, so a header clock reading
 * the tablet's own zone would be worse than no clock at all: it would look
 * authoritative and disagree with everything under it by however many hours the
 * device happens to be off.
 *
 * Renders nothing until mounted. The server can't know the current second at
 * paint time either, and rendering one value then correcting it is a hydration
 * mismatch.
 */
export function StaffClock({ timeZone }: { timeZone: string }) {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const format = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    });

    // The first tick lands within a second; skipping the synchronous call keeps
    // the effect free of a cascading render.
    const timer = setInterval(() => setTime(format.format(new Date())), 1000);
    return () => clearInterval(timer);
  }, [timeZone]);

  if (!time) return null;

  return (
    <time className="text-ink-muted hidden text-sm tabular-nums sm:inline">{time}</time>
  );
}
