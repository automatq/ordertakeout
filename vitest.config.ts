import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Run the suite in a deliberately hostile timezone.
 *
 * Every date calculation in this app is supposed to be independent of the
 * machine's clock — pickup dates are store-local, and the store's zone is passed
 * in explicitly. Running tests in the developer's own US timezone hides bugs
 * that depend on the process timezone, because a US machine happens to make the
 * wrong implementation look right.
 *
 * Pacific/Chatham is chosen for being maximally awkward: UTC+12:45, a 45-minute
 * offset, and it observes DST. A naive `new Date(y, m, d).toISOString()` lands
 * on the previous calendar day here and fails loudly, which is exactly what we
 * want. Verified: reverting lib/scheduling/time.ts to local-time arithmetic
 * fails these tests under this setting and passes under a US zone.
 */
process.env.TZ = "Pacific/Chatham";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
      /**
       * `server-only` is a bundler guard, not runtime behaviour.
       *
       * Its default export throws on import so Next can fail the build if a
       * server module reaches a client bundle. Under Vitest that would make every
       * server module untestable, so resolve it to the package's own no-op entry —
       * the same one Next uses via the `react-server` condition.
       */
      "server-only": path.resolve(import.meta.dirname, "node_modules/server-only/empty.js"),
    },
  },
});
