import { EmptyState } from "@/components/ui/empty-state";
import { LoafIcon } from "@/components/ui/icons";
import type { DashboardData, DashboardOrder, SlotGroup } from "@/lib/orders/dashboard";
import { summariseProduction } from "@/lib/orders/dashboard";
import { BADGE_CLASS, STATUS_EDGE, STATUS_LABEL } from "@/lib/orders/status";
import { formatPickupTime, formatStoreDate } from "@/lib/scheduling/time";

import { AutoRefresh } from "./auto-refresh";

/**
 * The kitchen's "what do I bake next" view.
 *
 * Same data as the order queue, pivoted: the queue is a list you work down,
 * this is a timeline you plan against.
 *
 * Still a server component with no controls — but no longer stale by design. It
 * used to render once and never update, while the queue driving the very
 * statuses it displays polled every fifteen seconds; a wall-mounted screen that
 * goes out of date the moment it loads is worse than no screen. `<AutoRefresh>`
 * is a thin client wrapper that re-renders this on an interval.
 *
 * The lanes are a horizontal rail rather than `lg:grid-cols-4`. With more than
 * four slots that grid *wrapped*, so 4 PM could render visually above 10 AM —
 * a timeline that lied about the order of time.
 */

/** Lanes wide enough to read a ticket in, narrow enough to see three at once. */
const LANE_WIDTH = "w-72";

export function PrepTimeline({ data, nowTime }: { data: DashboardData; nowTime: string }) {
  const hasOrders = data.days.some((day) => day.orderCount > 0);

  if (!hasOrders) {
    return (
      <div className="flex flex-col gap-6">
        <Heading newOrderCount={data.newOrderCount} />
        <EmptyState
          icon={<LoafIcon className="h-6 w-6" />}
          title="Nothing scheduled"
          description="Nothing is booked for the week ahead. Enjoy the quiet — this screen updates itself when orders come in."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <Heading newOrderCount={data.newOrderCount} />

      {data.days.map((day) => {
        const dayOrders = day.slots.flatMap((slot) => slot.orders);
        const production = summariseProduction(dayOrders);
        const upcomingLane = day.slots.findIndex((slot) => slot.time >= nowTime);
        const currentLane = day.date === data.today
          ? upcomingLane >= 0
            ? upcomingLane
            : day.slots.length - 1
          : -1;

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
                    className="rounded-control bg-surface-sunken text-ink flex items-baseline gap-1.5 px-3 py-1.5 text-kitchen"
                  >
                    <strong className="font-semibold">{line.quantity}&times;</strong>
                    {line.name}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="scroll-row gap-3">
              {day.slots.map((slot) => (
                <Lane
                  key={slot.time}
                  slot={slot}
                  isToday={day.date === data.today}
                  isCurrent={day.date === data.today && day.slots.indexOf(slot) === currentLane}
                />
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
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="font-display text-ink text-display-md font-normal uppercase">
        Prep timeline
      </h1>
      {newOrderCount > 0 ? (
        <span className="badge badge-new">{newOrderCount} not started</span>
      ) : null}
      <AutoRefresh className="ml-auto" />
    </div>
  );
}

function Lane({
  slot,
  isToday,
  isCurrent,
}: {
  slot: SlotGroup;
  isToday: boolean;
  isCurrent: boolean;
}) {
  const load = slot.capacity > 0
    ? Math.min(100, Math.round((slot.orders.length / slot.capacity) * 100))
    : slot.orders.length > 0
      ? 100
      : 0;

  return (
    <div className={`relative flex flex-col gap-2 rounded-card p-2 ${LANE_WIDTH} ${isCurrent ? "ring-brand bg-brand-tint ring-2" : ""}`}>
      {isCurrent ? (
        <span className="bg-brand text-brand-ink absolute inset-y-2 -left-0.5 w-0.5" aria-hidden />
      ) : null}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <h3 className="text-ink font-display text-2xl font-normal">
            {formatPickupTime(slot.time)}
          </h3>
          <span className="text-ink-subtle text-sm">
            {slot.orders.length}/{slot.capacity} order{slot.capacity === 1 ? "" : "s"}
          </span>
          {isCurrent ? <span className="tag tag-accent ml-auto">Now</span> : null}
        </div>

        {/* Actual configured capacity, including per-date staff overrides. */}
        <div
          className="bg-surface-sunken h-1.5 w-full overflow-hidden rounded-full"
          role="img"
          aria-label={`${slot.orders.length} of ${slot.capacity} available order spaces${
            isToday ? " today" : ""
          }`}
        >
          <div className={`${load >= 100 ? "bg-danger" : "bg-brand"} h-full rounded-full`} style={{ width: `${load}%` }} />
        </div>
      </div>

      <ul className="panel flex flex-1 flex-col gap-2 p-2">
        {slot.orders.length === 0 ? (
          <li className="text-ink-subtle p-3 text-center text-sm">Nothing in this slot</li>
        ) : (
          slot.orders.map((order) => <Ticket key={order.id} order={order} />)
        )}
      </ul>
    </div>
  );
}

function Ticket({ order }: { order: DashboardOrder }) {
  return (
    <li
      className={`rounded-control border-border bg-surface flex flex-col gap-2 border border-l-4 p-3 ${STATUS_EDGE[order.status]}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink font-semibold">{order.orderNumber}</span>
        <span className={BADGE_CLASS[order.status]}>{STATUS_LABEL[order.status]}</span>
      </div>

      {/* Was `text-xs truncate`, i.e. the name you'd call out across a kitchen
          set in the smallest type on the screen and then cut off. */}
      <p className="text-ink-muted text-sm">{order.customerName}</p>

      <ul className="text-ink-muted flex flex-col gap-0.5 text-kitchen">
        {order.items.map((item) => (
          <li key={item.id}>
            <strong className="text-ink font-semibold">{item.quantity}&times;</strong>{" "}
            {item.nameSnapshot}
          </li>
        ))}
      </ul>

      {/* Allergies and special requests were the smallest text on the busiest
          screen in the building. */}
      {order.customerNote ? (
        <p
          data-print-fill
          className="rounded-control bg-accent-soft text-accent-ink px-2 py-1.5 text-sm"
        >
          <strong className="font-semibold">Note:</strong> {order.customerNote}
        </p>
      ) : null}
    </li>
  );
}
