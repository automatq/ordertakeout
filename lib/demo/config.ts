/**
 * Demo mode.
 *
 * Lets the whole app be driven end to end without a Square account: the catalog
 * is served from a fixture and payments are simulated. Everything else — the
 * scheduling engine, slot reservation, capacity, the dashboard, notification
 * logging — runs for real against a real database.
 *
 * **It cannot be switched on in production.** A build that fakes payments must
 * never reach customers, so the environment check is deliberately belt-and-braces
 * rather than a single flag.
 */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1" && process.env.NODE_ENV !== "production";
}

/** Same check for client components, where NODE_ENV is inlined at build time. */
export function isDemoModeClient(): boolean {
  return (
    process.env.NEXT_PUBLIC_DEMO_MODE === "1" && process.env.NODE_ENV !== "production"
  );
}
