import type { OrderStatus } from "@/lib/db/schema";

/**
 * Pickup progress rail for a customer's order.
 *
 * Driven off `status` rather than the order's timestamps. The schema has
 * `paidAt`/`readyAt`/`completedAt` but no `preparingAt`, so a timestamp-driven
 * rail would silently skip a step — and a rail that disagrees with the status
 * shown above it is worse than one without times.
 *
 * Presentational and free of `server-only`/env imports on purpose: no timezone
 * formatting happens here, so the same component is safe on either side of the
 * boundary if the order page ever starts polling.
 */

const STEPS = [
  { label: "Order placed", caption: "We've received your order." },
  { label: "Preparing your order", caption: "Freshly made in the kitchen." },
  { label: "Ready for pickup", caption: "Waiting for you at the counter." },
  { label: "Picked up", caption: "Thanks — enjoy!" },
] as const;

/**
 * How far along the rail each status sits.
 *
 * `pending_payment` and `canceled` are absent deliberately: neither is a point
 * on the happy path, and the page renders its own copy for those.
 */
const REACHED: Partial<Record<OrderStatus, number>> = {
  paid: 0,
  preparing: 1,
  ready: 2,
  completed: 3,
};

export function OrderProgress({ status }: { status: OrderStatus }) {
  const reached = REACHED[status];
  if (reached === undefined) return null;

  return (
    <section aria-label="Order progress" className="flex flex-col gap-3">
      <h2 className="text-ink-subtle text-sm font-semibold tracking-wide uppercase">
        Progress
      </h2>

      <ol className="flex flex-col">
        {STEPS.map((step, index) => {
          const isDone = index < reached;
          const isCurrent = index === reached;
          const isLast = index === STEPS.length - 1;

          return (
            <li key={step.label} className="relative flex gap-4 pb-6 last:pb-0">
              {/* Connector, drawn behind the dot and stopping at the last step. */}
              {!isLast ? (
                <span
                  aria-hidden
                  className={`absolute top-6 bottom-0 left-[11px] w-0.5 ${
                    isDone ? "bg-status-ready" : "bg-border"
                  }`}
                />
              ) : null}

              <span
                aria-hidden
                className={`relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                  isDone
                    ? "border-status-ready bg-status-ready text-surface"
                    : isCurrent
                      ? "border-status-preparing bg-surface text-status-preparing ring-status-preparing-soft ring-4"
                      : "border-border-strong bg-surface"
                }`}
              >
                {isDone ? "✓" : null}
              </span>

              <span className="flex flex-col gap-0.5">
                {/* Never colour alone: the state is in the text as well as the dot. */}
                <span
                  className={`font-semibold ${
                    isCurrent ? "text-status-preparing" : isDone ? "text-ink" : "text-ink-subtle"
                  }`}
                >
                  {step.label}
                  {isCurrent ? " — in progress" : null}
                </span>
                <span className="text-ink-muted text-sm">{step.caption}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
