import Link from "next/link";

import { signOut } from "@/app/actions/staff";
import { requireStaffSession } from "@/lib/auth/guard";

/**
 * Guard for every staff route.
 *
 * A route group `(dashboard)` so the login page at /staff/login sits outside it
 * and stays reachable. Note the server actions re-check the session themselves —
 * this layout stops the page rendering, but actions are separately addressable
 * and need their own check.
 */

/**
 * Blocking rather than streamed, deliberately.
 *
 * Reading the session cookie is runtime data, which Cache Components would
 * normally want wrapped in Suspense so a shell can stream first. That is exactly
 * wrong for an authorization gate: streaming a staff-looking shell before we know
 * whether the visitor is staff is both a flash of the wrong UI and a bad signal.
 * Nothing here benefits from prerendering anyway — every staff view is live.
 */
export const instant = false;
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  await requireStaffSession();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-border bg-surface sticky top-0 z-10 border-b print:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-baseline gap-4">
            <Link href="/staff" className="font-display text-ink font-semibold">
              Orders
            </Link>
            <Link
              href="/staff/timeline"
              className="text-ink-muted hover:text-brand text-sm transition-colors"
            >
              Timeline
            </Link>
            <Link
              href="/staff/analytics"
              className="text-ink-muted hover:text-brand text-sm transition-colors"
            >
              Sales
            </Link>
            <Link
              href="/staff/closed"
              className="text-ink-muted hover:text-brand text-sm transition-colors"
            >
              Completed
            </Link>
            <Link
              href="/staff/settings"
              className="text-ink-muted hover:text-brand text-sm transition-colors"
            >
              Settings
            </Link>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="text-ink-muted hover:text-brand text-sm transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
