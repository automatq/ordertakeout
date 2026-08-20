import Link from "next/link";

import { RANGES, type SalesAnalytics } from "@/lib/orders/analytics";
import { salesAnalyticsCsv } from "@/lib/orders/analytics-export";
import { formatStoreDate } from "@/lib/scheduling/time";
import { formatMoney } from "@/lib/square/money";
import type { StoreLocation } from "@/lib/locations/types";

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
 *
 * Three fixes in the overhaul:
 *
 *  - There's a scale. One gridline at the maximum meant you could read the
 *    *shape* of a week but not the magnitude of any single day.
 *  - The bars are readable on a tablet. Their only readout was a native `title`
 *    tooltip, which never appears on touch — the one device staff use this on.
 *    They're focusable with a real tooltip now, and below `lg` the chart becomes
 *    a horizontal bar list, because 30 vertical bars in a phone-width column are
 *    ~2% wide each.
 *  - `TopItems` can't divide by zero (see the guard below).
 */

/** Chart plot height. A token would be overkill; it's used once. */
const PLOT_HEIGHT = "h-44";

export function SalesAnalytics({ data, locations, locationId }: { data: SalesAnalytics; locations: StoreLocation[]; locationId?: string }) {
  const { current, previous, currency } = data;
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(salesAnalyticsCsv(data))}`;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-ink text-display-md font-normal uppercase">
          Sales &amp; orders
        </h1>

        {/* Filters in one row above the charts. */}
        <nav aria-label="Date range" className="flex gap-2">
          {RANGES.map((range) => {
            const isActive = range.days === data.days;
            return (
              <Link
                key={range.days}
                href={`/staff/analytics?range=${range.days}${locationId ? `&location=${encodeURIComponent(locationId)}` : ""}`}
                aria-current={isActive ? "page" : undefined}
                className={`rounded-pill border px-3 py-1.5 text-sm font-semibold transition-colors ${
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

      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="range" value={data.days} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-subtle font-medium">Location</span>
          <select name="location" defaultValue={locationId ?? ""} className="input">
            <option value="">All locations</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </label>
        <button type="submit" className="btn btn-secondary btn-sm">Apply</button>
        <a
          href={csvHref}
          download={`harina-sales-${data.from}-${data.to}.csv`}
          className="btn btn-ghost btn-sm"
        >
          Export CSV
        </a>
      </form>

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
    <div className="card flex flex-col gap-1 p-4">
      <span className="text-ink-subtle text-xs font-semibold tracking-wide uppercase">
        {label}
      </span>
      <span className="text-ink font-display text-3xl font-normal tabular-nums">{value}</span>
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
  const points = data.byDay.map((current, index) => ({
    current,
    previous: data.previousByDay[index],
  }));
  const max = Math.max(
    ...data.byDay.map((d) => d.revenueCents),
    ...data.previousByDay.map((d) => d.revenueCents),
    0,
  );
  const peak = data.byDay.reduce(
    (best, d) => (d.revenueCents > best.revenueCents ? d : best),
    data.byDay[0]!,
  );

  // 30 bars can't each carry a label; thin them out rather than let them collide.
  const labelEvery = data.byDay.length > 14 ? 5 : 1;

  if (max === 0) {
    return (
      <figure className="card flex flex-col gap-2 p-5">
        <figcaption className="text-ink font-semibold">Revenue by pickup day</figcaption>
        <p className="text-ink-muted text-sm">No pickups in either comparison period.</p>
      </figure>
    );
  }

  const ticks = [max, Math.round(max / 2), 0];

  return (
    <figure className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <figcaption className="text-ink font-semibold">
          Revenue by pickup day
          <span className="text-ink-subtle ml-2 text-sm font-normal">
            {peak.revenueCents > 0
              ? `peak ${formatMoney(peak.revenueCents, data.currency)} on ${formatStoreDate(peak.date, "short")}`
              : "no revenue in the current period"}
          </span>
        </figcaption>
        <div className="text-ink-subtle flex items-center gap-4 text-xs" aria-label="Chart legend">
          <span className="flex items-center gap-1.5"><span aria-hidden className="bg-brand h-2.5 w-2.5 rounded-sm" />Current</span>
          <span className="flex items-center gap-1.5"><span aria-hidden className="bg-border-strong h-2.5 w-2.5 rounded-sm" />Previous</span>
        </div>
      </div>

      {/* Vertical bars from `lg` up. Below that the same data renders as the
          horizontal list further down — 30 bars across a phone is unreadable. */}
      <div className="hidden lg:block">
        {/* A grid rather than the old `pl-18`/`ml-18` pair, which had to be kept
            in sync with a `w-16` label by hand and only resolved at all because
            of Tailwind v4's dynamic spacing. */}
        <div className="grid grid-cols-[4.5rem_1fr] gap-x-2">
          <div className={`relative ${PLOT_HEIGHT}`}>
            {ticks.map((tick, index) => (
              <span
                key={tick}
                className="text-ink-subtle absolute right-0 -translate-y-1/2 text-xs tabular-nums"
                style={{ top: `${(index / (ticks.length - 1)) * 100}%` }}
              >
                {formatMoney(tick, data.currency)}
              </span>
            ))}
          </div>

          <div className={`relative ${PLOT_HEIGHT}`}>
            {/* Gridlines behind the bars, at the same stops as the labels. */}
            {ticks.map((tick, index) => (
              <span
                key={tick}
                aria-hidden
                className={`absolute inset-x-0 h-px ${
                  index === ticks.length - 1 ? "bg-border-strong" : "bg-border"
                }`}
                style={{ top: `${(index / (ticks.length - 1)) * 100}%` }}
              />
            ))}

            <div className="absolute inset-0 flex items-end gap-0.5">
              {points.map(({ current, previous }) => (
                <button
                  key={current.date}
                  type="button"
                  aria-label={`${formatStoreDate(current.date, "medium")}: ${formatMoney(
                    current.revenueCents,
                    data.currency,
                  )} from ${current.orderCount} order${current.orderCount === 1 ? "" : "s"}; previous period ${previous ? `${formatStoreDate(previous.date, "medium")}: ${formatMoney(previous.revenueCents, data.currency)}` : "unavailable"}`}
                  className="group relative flex h-full min-w-0 flex-1 items-end border-0 bg-transparent p-0"
                >
                  <span className="flex h-full w-full items-end gap-px" aria-hidden>
                    <span
                      className="bg-border-strong w-1/2 rounded-t"
                      style={{ height: `${Math.max(((previous?.revenueCents ?? 0) / max) * 100, previous?.revenueCents ? 2 : 0)}%` }}
                    />
                    <span
                      className="bg-brand group-hover:bg-brand-hover group-focus-visible:bg-brand-hover w-1/2 rounded-t transition-colors"
                      style={{ height: `${Math.max((current.revenueCents / max) * 100, current.revenueCents > 0 ? 2 : 0)}%` }}
                    />
                  </span>
                  <span
                    aria-hidden
                    className="bg-ink text-canvas rounded-control pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 px-2 py-1 text-xs whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                  >
                    {formatStoreDate(current.date, "short")} · {formatMoney(current.revenueCents, data.currency)} · prev {formatMoney(previous?.revenueCents ?? 0, data.currency)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <span />
          <div className="flex gap-0.5 pt-1">
            {data.byDay.map((point, index) => (
              <span
                key={point.date}
                className="text-ink-subtle flex-1 overflow-hidden text-center text-xs whitespace-nowrap"
              >
                {index % labelEvery === 0 ? formatStoreDate(point.date, "short") : ""}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Small-screen view: horizontal bars, which stay legible at any count. */}
      <ol className="flex flex-col gap-1.5 lg:hidden">
        {points
          .filter(({ current, previous }) => current.revenueCents > 0 || (previous?.revenueCents ?? 0) > 0)
          .map(({ current, previous }) => (
            <li key={current.date} className="grid grid-cols-[4rem_1fr_auto] items-center gap-3 text-sm">
              <span className="text-ink-subtle tabular-nums">{formatStoreDate(current.date, "short")}</span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="bg-surface-sunken h-2 overflow-hidden rounded-full">
                  <span className="bg-brand block h-full rounded-full" style={{ width: `${(current.revenueCents / max) * 100}%` }} />
                </span>
                <span className="bg-surface-sunken h-2 overflow-hidden rounded-full">
                  <span className="bg-border-strong block h-full rounded-full" style={{ width: `${((previous?.revenueCents ?? 0) / max) * 100}%` }} />
                </span>
              </span>
              <span className="text-ink flex flex-col text-right text-xs tabular-nums">
                <span>{formatMoney(current.revenueCents, data.currency)}</span>
                <span className="text-ink-subtle">{formatMoney(previous?.revenueCents ?? 0, data.currency)}</span>
              </span>
            </li>
          ))}
      </ol>

      {/* The numbers behind the bars, for screen readers and anyone who wants exact figures. */}
      <details open className="text-sm">
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
                Current revenue
              </th>
              <th scope="col" className="py-1 text-right font-semibold">
                Previous revenue
              </th>
            </tr>
          </thead>
          <tbody className="text-ink">
            {points.map(({ current, previous }) => (
              <tr key={current.date} className="border-border border-t">
                <td className="py-1">{formatStoreDate(current.date, "medium")}</td>
                <td className="py-1 text-right tabular-nums">{current.orderCount}</td>
                <td className="py-1 text-right tabular-nums">
                  {formatMoney(current.revenueCents, data.currency)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {formatMoney(previous?.revenueCents ?? 0, data.currency)}
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
  const totalQuantity = data.topItems.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <section className="card flex flex-col gap-3 p-5">
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
                  /* Guarded: a non-empty list whose quantities are all zero used
                     to produce `0/0` and render width: NaN%. The chart above
                     already guarded for exactly this. */
                  style={{ width: max === 0 ? "0%" : `${(item.quantity / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}

      {totalQuantity > 0 ? (
        <p className="text-ink-subtle text-xs">
          {totalQuantity} item{totalQuantity === 1 ? "" : "s"} across the top{" "}
          {data.topItems.length}.
        </p>
      ) : null}
    </section>
  );
}

function Booked({ data }: { data: SalesAnalytics }) {
  return (
    <section className="card flex flex-col gap-2 p-5">
      <h2 className="text-ink font-semibold">Booked ahead</h2>
      <p className="text-ink-muted text-sm">
        Paid orders for pickup after today. Not counted in the figures above.
      </p>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="text-ink font-display text-3xl font-normal tabular-nums">
          {formatMoney(data.upcoming.revenueCents, data.currency)}
        </span>
        <span className="text-ink-muted text-sm">
          across {data.upcoming.orderCount} order{data.upcoming.orderCount === 1 ? "" : "s"}
        </span>
      </div>
      <Link href="/staff/timeline" className="btn btn-ghost btn-sm mt-2 self-start">
        See the prep timeline
      </Link>
    </section>
  );
}
