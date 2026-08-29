/**
 * Vitest stand-in for `@sentry/nextjs`.
 *
 * `lib/monitoring/report.ts` imports the SDK at module scope, so without this
 * alias every test that touches an order/webhook/catalog module would drag the
 * whole Sentry + OpenTelemetry tree into the run. The suite is hermetic and
 * fast; monitoring behaviour is tested in lib/monitoring/report.test.ts, which
 * overrides this alias with its own vi.mock. Wired up as a resolve alias in
 * vitest.config.ts, same approach as `server-only` and `next/cache`.
 */

export function init(_options?: unknown): void {}

export function captureException(_error: unknown, _context?: unknown): void {}

export function captureMessage(_message: string, _context?: unknown): void {}

export async function captureRequestError(
  _error: unknown,
  _request: unknown,
  _context: unknown,
): Promise<void> {}
