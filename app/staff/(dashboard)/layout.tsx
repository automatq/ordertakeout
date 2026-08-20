import { signOut } from "@/app/actions/staff";
import { StaffClock, StaffNav } from "@/components/staff/staff-nav";
import { serverEnv } from "@/lib/env";
import { STORE_INFO } from "@/lib/store";
import { requireStaffSession } from "@/lib/auth/guard";
import { SignOutIcon } from "@/components/ui/icons";

/**
 * Guard for every staff route.
 *
 * A route group `(dashboard)` so the login page at /staff/login sits outside it
 * and stays reachable. Note the server actions re-check the session themselves —
 * this layout stops the page rendering, but actions are separately addressable
 * and need their own check.
 *
 * Since the storefront chrome moved into `app/(storefront)`, this is the only
 * header on a staff route. Before, the root layout wrapped it: the bakery logo,
 * a "Call us on…" line and a customer cart link sat above the order queue, two
 * sticky headers stacked to eat ~140px of a 768px-tall tablet, and all of it
 * printed at the top of every prep sheet.
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
      <header className="bg-canvas/90 border-border shadow-sticky sticky top-0 z-50 border-b backdrop-blur-xl print:hidden">
        <div className="shell flex items-center gap-3 py-2.5">
          <span className="font-display text-brand hidden text-xl font-normal uppercase lg:inline">
            {STORE_INFO.name}
          </span>

          <StaffNav />

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <StaffClock timeZone={serverEnv().STORE_TIMEZONE} />
            <form action={signOut}>
              <button
                type="submit"
                aria-label="Sign out"
                title="Sign out"
                /* Moved away from the nav and given its own visual weight: it
                   used to be a text link at the same size and colour as the
                   navigation, inches from it, on a touchscreen. */
                className="btn btn-secondary btn-icon btn-sm"
              >
                <SignOutIcon className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
