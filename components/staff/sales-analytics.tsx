import Link from "next/link";

import { RANGES, type PeriodTotals, type SalesAnalytics } from "@/lib/orders/analytics";
import { formatStoreDate } from "@/lib/scheduling/time";
import { formatMoney } from "@/lib/square/money";

/**
 * Staff sales screen.
 *
 * A server component: these are historical aggregates, so unlike the kitchen
 * queue there is nothing to poll and no reason to ship a client bundle. The
 * range filter is a plain link that re-renders the page.
 *
 * The bar chart is deliberately hand-rolled rather than pulling in a charting
 * library. It is one series over one axis — a flex row of divs does it, and a
 * library would drag in its own colour system, which this app's token lint
 * exists to prevent.
 */

export function SalesAnalytics({ data }: { data: SalesAnalytics }) {
  const { current, previous, currency } = data;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-ink text-2xl font-semibold">Sales &amp; orders</h1>

        {/* Filters in one row above the charts. */}
        <nav aria-label="Date range" className="flex gap-2">
          {RANGES.map((range) => {
            const isActive = range.days === data.days;
            return (
              <Link
                key={range.days}
                href={`/staff/analytics?range=${range.days}`}
                aria-current={isActive ? "page" : undefined}
                className={`rounded-control border px-3 py-1.5 text-sm font-semibold transition-colors ${
                  isActive
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-border bg-surface text-ink-muted hover:border-border-strong"
                }`}
              >
                {range.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <p className="text-ink-subtle -mt-4 text-sm">
        Pickups from {formatStoreDate(data.from, "medium")} to{" "}
        {formatStoreDate(data.to, "medium")}, compared with the previous{" "}
        {data.days === 1 ? "day" : `${data.days} days`}.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Revenue"
          value={formatMoney(current.revenueCents, currency)}
          delta={delta(current.revenueCents, previous.revenueCents)}
        />
        <Stat
          label="Orders"
          value={String(current.orderCount)}
          delta={delta(current.orderCount, previous.orderCount)}
        />
        <Stat
          label="Average order"
          value={current.orderCount === 0 ? "—" : formatMoney(current.avgOrderCents, currency)}
          delta={delta(current.avgOrderCents, previous.avgOrderCents)}
        />
        <Stat
          label="Cancelled"
          value={String(current.canceledCount)}
          delta={delta(current.canceledCount, previous.canceledCount)}
          lowerIsBetter
        />
      </div>

      <RevenueChart data={data} />

      <div className="grid gap-6 lg:grid-cols-2">
        <TopItems data={data} />
        <Booked data={data} />
      </div>
    </div>
  );
}

/** Percentage change, or null when there's no baseline to compare against. */
function delta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function Stat({
  label,
  value,
  delta,
  lowerIsBetter = false,
}: {
  label: string;
  value: string;
  delta: number | null;
  lowerIsBetter?: boolean;
}) {
  const isGood = delta === null || delta === 0 ? null : delta > 0 !== lowerIsBetter;

  return (
    <div className="rounded-card border-border bg-surface flex flex-col gap-1 border p-4">
      <span className="text-ink-subtle text-xs font-semibold tracking-wide uppercase">
        {label}
      </span>
      <span className="text-ink text-2xl font-semibold tabular-nums">{value}</span>
      {delta === null ? (
        <span className="text-ink-subtle text-sm">No prior period</span>
      ) : (
        /* Arrow plus sign, never colour alone. */
        <span
          className={`text-sm font-semibold ${
            isGood === null ? "text-ink-subtle" : isGood ? "text-success" : "text-danger"
          }`}
        >
          {delta > 0 ? "▲" : delta < 0 ? "▼" : "■"} {Math.abs(delta)}% vs previous
        </span>
      )}
    </div>
  );
}

function RevenueChart({ data }: { data: SalesAnalytics }) {
  const max = Math.max(...data.byDay.map((d) => d.revenueCents), 0);
  const peak = data.byDay.reduce(
    (best, d) => (d.revenueCents > best.revenueCents ? d : best),
    data.byDay[0]!,
  );

  // 30 bars can't each carry a label; thin them out rather than let them collide.
  const labelEvery = data.byDay.length > 14 ? 5 : 1;

  if (max === 0) {
    return (
      <figure className="rounded-card border-border bg-surface flex flex-col gap-2 border p-5">
        <figcaption className="text-ink font-semibold">Revenue by pickup day</figcaption>
        <p className="text-ink-muted text-sm">No pickups in this range yet.</p>
      </figure>
    );
  }

  return (
    <figure className="rounded-card border-border bg-surface flex flex-col gap-4 border p-5">
      <figcaption className="text-ink font-semibold">
        Revenue by pickup day
        <span className="text-ink-subtle ml-2 text-sm font-normal">
          peak {formatMoney(peak.revenueCents, data.currency)} on{" "}
          {formatStoreDate(peak.date, "short")}
        </span>
      </figcaption>

      <div className="flex flex-col gap-1">
        {/* A single recessive gridline carries the scale, so bars need no labels. */}
        <div className="flex items-center gap-2">
          <span className="text-ink-subtle w-16 shrink-0 text-right text-xs tabular-nums">
            {formatMoney(max, data.currency)}
          </span>
          <span aria-hidden className="bg-border h-px flex-1" />
        </div>

        <div className="flex items-end gap-0.5 pl-18" style={{ height: "11rem" }}>
          {data.byDay.map((point) => (
            <div
              key={point.date}
              title={`${formatStoreDate(point.date, "medium")} — ${formatMoney(point.revenueCents, data.currency)}, ${point.orderCount} order${point.orderCount === 1 ? "" : "s"}`}
              className="flex h-full flex-1 items-end"
            >
              <div
                className="bg-brand w-full rounded-t"
                style={{ height: `${Math.max((point.revenueCents / max) * 100, point.revenueCents > 0 ? 2 : 0)}%` }}
              />
            </div>
          ))}
        </div>

        <div aria-hidden className="bg-border-strong ml-18 h-px" />

        <div className="flex gap-0.5 pl-18">
          {data.byDay.map((point, index) => (
            <span
              key={point.date}
              className="text-ink-subtle flex-1 text-center text-xs whitespace-nowrap"
            >
              {index % labelEvery === 0 || index === data.byDay.length - 1
                ? formatStoreDate(point.date, "short")
                : ""}
            </span>
          ))}
        </div>
      </div>

      {/* The numbers behind the bars, for screen readers and anyone who wants exact figures. */}
      <details className="text-sm">
        <summary className="text-ink-muted hover:text-brand cursor-pointer">
          View as table
        </summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="text-ink-subtle text-xs uppercase">
              <th scope="col" className="py-1 font-semibold">
                Pickup day
              </th>
              <th scope="col" className="py-1 text-right font-semibold">
                Orders
              </th>
              <th scope="col" className="py-1 text-right font-semibold">
                Revenue
              </th>
            </tr>
          </thead>
          <tbody className="text-ink">
            {data.byDay.map((point) => (
              <tr key={point.date} className="border-border border-t">
                <td className="py-1">{formatStoreDate(point.date, "medium")}</td>
                <td className="py-1 text-right tabular-nums">{point.orderCount}</td>
                <td className="py-1 text-right tabular-nums">
                  {formatMoney(point.revenueCents, data.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

function TopItems({ data }: { data: SalesAnalytics }) {
  const max = Math.max(...data.topItems.map((i) => i.quantity), 0);

  return (
    <section className="rounded-card border-border bg-surface flex flex-col gap-3 border p-5">
      <h2 className="text-ink font-semibold">Top items</h2>

      {data.topItems.length === 0 ? (
        <p className="text-ink-muted text-sm">Nothing sold in this range yet.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {data.topItems.map((item, index) => (
            <li key={item.name} className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2 text-sm">
                <span className="text-ink-subtle w-4 shrink-0 font-semibold tabular-nums">
                  {index + 1}
                </span>
                <span className="text-ink flex-1">{item.name}</span>
                <span className="text-ink font-semibold tabular-nums">{item.quantity}</span>
                <span className="text-ink-subtle w-20 text-right tabular-nums">
                  {formatMoney(item.revenueCents, data.currency)}
                </span>
              </div>
              <div className="bg-surface-sunken ml-6 h-1.5 overflow-hidden rounded-full">
                <div
                  className="bg-brand h-full rounded-full"
                  style={{ width: `${(item.quantity / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Booked({ data }: { data: SalesAnalytics }) {
  return (
    <section className="rounded-card border-border bg-surface flex flex-col gap-2 border p-5">
      <h2 className="text-ink font-semibold">Booked ahead</h2>
      <p className="text-ink-muted text-sm">
        Paid orders for pickup after today. Not counted in the figures above.
      </p>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="text-ink text-2xl font-semibold tabular-nums">
          {formatMoney(data.upcoming.revenueCents, data.currency)}
        </span>
        <span className="text-ink-muted text-sm">
          across {data.upcoming.orderCount} order{data.upcoming.orderCount === 1 ? "" : "s"}
        </span>
      </div>
    </section>
  );
}
