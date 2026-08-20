import type { OrderStatus } from "@/lib/db/schema";
import { orderProgressStepState } from "@/lib/orders/progress";

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

export function OrderProgress({ status }: { status: OrderStatus }) {
  if (orderProgressStepState(status, 0) === null) return null;

  return (
    <section
      aria-label="Order progress"
      className="card flex flex-col gap-5 rounded-[2rem] p-6 sm:p-8"
    >
      <div>
        <p className="text-secondary text-xs font-semibold tracking-[0.14em] uppercase">
          Fresh from our kitchen
        </p>
        <h2 className="font-display text-ink mt-1 text-3xl font-normal uppercase">
          Order progress
        </h2>
      </div>

      <ol className="flex flex-col">
        {STEPS.map((step, index) => {
          const { isDone, isCurrent } = orderProgressStepState(status, index)!;
          const isLast = index === STEPS.length - 1;

          return (
            <li
              key={step.label}
              /* The step's position is already in the text ("— in progress"),
                 but assistive tech reading the list on its own still needs to
                 know which item is the current one. */
              aria-current={isCurrent ? "step" : undefined}
              className="relative flex gap-4 pb-7 last:pb-0"
            >
              {/* Connector, drawn behind the dot and stopping at the last step. */}
              {!isLast ? (
                <span
                  aria-hidden
                  className={`absolute top-7 bottom-0 left-[15px] w-0.5 ${
                    isDone ? "bg-secondary" : "bg-border"
                  }`}
                />
              ) : null}

              <span
                aria-hidden
                className={`relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                  isDone
                    ? "border-secondary bg-secondary text-secondary-ink"
                    : isCurrent
                      ? "border-accent bg-accent text-ink ring-accent-soft ring-4"
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
