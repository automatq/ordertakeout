import type { OrderStatus } from "@/lib/db/schema";
import type { DashboardData, DashboardOrder } from "@/lib/orders/dashboard";
import { summariseProduction } from "@/lib/orders/dashboard";
import { STATUS_LABEL } from "@/lib/orders/status";
import { formatPickupTime, formatStoreDate } from "@/lib/scheduling/time";

/**
 * The kitchen's "what do I bake next" view.
 *
 * Same data as the order queue, pivoted: the queue is a list you work down,
 * this is a timeline you plan against. Slots become side-by-side lanes so the
 * 4 PM crush is visible at a glance instead of being buried below the fold.
 *
 * A server component — unlike the queue it has no controls, so it needs no
 * polling and no client bundle. Staff advance orders from the queue screen.
 */

const STATUS_CLASS: Record<OrderStatus, string> = {
  pending_payment: "bg-surface-sunken text-ink-subtle",
  paid: "bg-status-new-soft text-status-new",
  preparing: "bg-status-preparing-soft text-status-preparing",
  ready: "bg-status-ready-soft text-status-ready",
  completed: "bg-status-completed-soft text-status-completed",
  canceled: "bg-status-canceled-soft text-status-canceled",
};

/** Left edge of a ticket — a second, non-colour-only cue is in the badge. */
const STATUS_EDGE: Record<OrderStatus, string> = {
  pending_payment: "border-l-border-strong",
  paid: "border-l-status-new",
  preparing: "border-l-status-preparing",
  ready: "border-l-status-ready",
  completed: "border-l-status-completed",
  canceled: "border-l-status-canceled",
};

export function PrepTimeline({ data }: { data: DashboardData }) {
  const hasOrders = data.days.some((day) => day.orderCount > 0);

  if (!hasOrders) {
    return (
      <div className="flex flex-col gap-6">
        <Heading newOrderCount={data.newOrderCount} />
        <p className="text-ink-muted">Nothing scheduled. Enjoy the quiet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <Heading newOrderCount={data.newOrderCount} />

      {data.days.map((day) => {
        const dayOrders = day.slots.flatMap((slot) => slot.orders);
        const production = summariseProduction(dayOrders);

        return (
          <section key={day.date} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-ink text-lg font-semibold">
                {day.date === data.today ? "Today · " : ""}
                {formatStoreDate(day.date, "medium")}
              </h2>
              <span className="text-ink-subtle text-sm">
                {day.orderCount} order{day.orderCount === 1 ? "" : "s"}
              </span>
            </div>

            {/* Totals first: at 5am the kitchen bakes from these, not from names. */}
            {production.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {production.map((line) => (
                  <li
                    key={line.name}
                    className="rounded-control bg-surface-sunken text-ink flex items-baseline gap-1.5 px-3 py-1.5 text-sm"
                  >
                    <strong className="font-semibold">{line.quantity}&times;</strong>
                    {line.name}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {day.slots.map((slot) => (
                <div key={slot.time} className="flex flex-col gap-2">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-ink font-semibold">{formatPickupTime(slot.time)}</h3>
                    <span className="text-ink-subtle text-xs">
                      {slot.orders.length} order{slot.orders.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <ul className="rounded-card bg-surface-sunken flex flex-col gap-2 p-2">
                    {slot.orders.map((order) => (
                      <Ticket key={order.id} order={order} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Heading({ newOrderCount }: { newOrderCount: number }) {
  return (
    <div className="flex flex-wrap items-baseline gap-3">
      <h1 className="font-display text-ink text-2xl font-semibold">Prep timeline</h1>
      {newOrderCount > 0 ? (
        <span className="bg-status-new-soft text-status-new rounded-control px-2 py-1 text-sm font-semibold">
          {newOrderCount} not started
        </span>
      ) : null}
    </div>
  );
}

function Ticket({ order }: { order: DashboardOrder }) {
  return (
    <li
      className={`rounded-control border-border bg-surface flex flex-col gap-2 border border-l-4 p-3 ${STATUS_EDGE[order.status]}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink text-sm font-semibold">{order.orderNumber}</span>
        <span
          className={`rounded-control px-1.5 py-0.5 text-xs font-semibold ${STATUS_CLASS[order.status]}`}
        >
          {STATUS_LABEL[order.status]}
        </span>
        <span className="text-ink-subtle ml-auto truncate text-xs">{order.customerName}</span>
      </div>

      <ul className="text-ink-muted flex flex-col gap-0.5 text-sm">
        {order.items.map((item) => (
          <li key={item.id}>
            <strong className="text-ink font-semibold">{item.quantity}&times;</strong>{" "}
            {item.nameSnapshot}
          </li>
        ))}
      </ul>

      {order.customerNote ? (
        <p className="rounded-control bg-accent-soft text-accent-ink px-2 py-1 text-xs">
          {order.customerNote}
        </p>
      ) : null}
    </li>
  );
}
