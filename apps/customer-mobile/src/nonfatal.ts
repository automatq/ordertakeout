/**
 * Records a recoverable native failure without letting an event handler or
 * effect turn it into an unhandled rejection. Keep the context operational and
 * free of customer data: this is visible in native development logs.
 */
export function reportNonFatal(context: string, cause: unknown): void {
  if (!__DEV__) return;
  const message = cause instanceof Error ? cause.message : String(cause);
  console.warn(`[Harina] ${context}: ${message}`);
}

/** Run a device operation that must not take the customer out of their flow. */
export async function attempt<T>(
  context: string,
  operation: () => Promise<T>,
  report: (context: string, cause: unknown) => void = reportNonFatal,
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await operation() };
  } catch (cause) {
    report(context, cause);
    return { ok: false };
  }
}
