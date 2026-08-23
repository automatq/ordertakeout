import { connection } from "next/server";
import { Suspense } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { ListSkeleton } from "@/components/ui/skeleton";
import { listAuditLog } from "@/lib/audit/log";
import { serverEnv } from "@/lib/env";
import { formatStoreDate, isStoreDate, storeToday } from "@/lib/scheduling/time";
import { formatInTimeZone } from "date-fns-tz";
import { fromZonedTime } from "date-fns-tz";

export const metadata = { title: "Activity — Staff" };

/**
 * The append-only activity log: who changed what, when. Filters live in the
 * URL as a plain GET form (works without JS, bookmarkable) — same pattern as
 * the closed-orders screen.
 */

const PAGE_SIZE = 50;

const KNOWN_ACTIONS = [
  { value: "", label: "Everything" },
  { value: "order.status_changed", label: "Status changes" },
  { value: "order.canceled", label: "Cancellations" },
  { value: "order.refunded", label: "Refunds" },
  { value: "order.pickup_verified", label: "Pickup verifications" },
  { value: "product.86ed", label: "86ed items" },
  { value: "ordering.paused", label: "Ordering paused" },
  { value: "ordering.resumed", label: "Ordering resumed" },
  { value: "staff.added", label: "Roster changes" },
] as const;

type PageProps = {
  searchParams: Promise<{ action?: string; initials?: string; from?: string; to?: string; page?: string }>;
};

export default function AuditPage({ searchParams }: PageProps) {
  return (
    <div className="shell-tight flex flex-col gap-6 py-8">
      <div>
        <h1 className="font-display text-ink text-display-md font-normal uppercase">Activity</h1>
        <p className="text-ink-muted text-sm">
          Every operator-relevant change, oldest kept forever. Initials come from the staff
          roster in Settings.
        </p>
      </div>
      <Suspense fallback={<ListSkeleton label="Loading activity" rows={8} />}>
        <AuditList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function AuditList({ searchParams }: PageProps) {
  await connection();
  const params = await searchParams;
  const timeZone = serverEnv().STORE_TIMEZONE;
  const today = storeToday(new Date(), timeZone);

  const action = KNOWN_ACTIONS.some((known) => known.value === params.action) && params.action
    ? params.action
    : undefined;
  const initials = params.initials?.trim() ? params.initials.trim() : undefined;
  const from = params.from && isStoreDate(params.from) ? params.from : undefined;
  const to = params.to && isStoreDate(params.to) ? params.to : undefined;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const rows = await listAuditLog({
    action,
    actorInitials: initials,
    from: from ? fromZonedTime(`${from}T00:00:00`, timeZone) : undefined,
    to: to ? fromZonedTime(`${to}T23:59:59.999`, timeZone) : undefined,
    limit: PAGE_SIZE + 1,
    offset: (page - 1) * PAGE_SIZE,
  });
  const hasNext = rows.length > PAGE_SIZE;
  const visible = rows.slice(0, PAGE_SIZE);

  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (action) query.set("action", action);
    if (initials) query.set("initials", initials);
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (target > 1) query.set("page", String(target));
    const suffix = query.toString();
    return `/staff/audit${suffix ? `?${suffix}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-subtle font-medium">Show</span>
          <select name="action" defaultValue={action ?? ""} className="input">
            {KNOWN_ACTIONS.map((known) => (
              <option key={known.value} value={known.value}>{known.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-subtle font-medium">Initials</span>
          <input name="initials" defaultValue={initials ?? ""} maxLength={6} className="input w-24" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-subtle font-medium">From</span>
          <input type="date" name="from" defaultValue={from ?? ""} max={today} className="input" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-subtle font-medium">To</span>
          <input type="date" name="to" defaultValue={to ?? ""} max={today} className="input" />
        </label>
        <button type="submit" className="btn btn-secondary btn-sm">Apply</button>
      </form>

      {visible.length === 0 ? (
        <EmptyState
          title="Nothing recorded yet"
          description="Status changes, refunds, 86es, pauses, and pickup verifications will appear here as they happen."
        />
      ) : (
        <ol className="flex flex-col gap-2">
          {visible.map((entry) => (
            <li key={entry.id} className="panel flex flex-wrap items-baseline justify-between gap-2 p-3 text-sm">
              <div className="min-w-0">
                <p className="text-ink">
                  <strong className="font-semibold">{describeAction(entry.action)}</strong>
                  {describeMetadata(entry.metadata)}
                </p>
                <p className="text-ink-subtle text-xs">
                  {entry.actorType === "staff"
                    ? entry.actorInitials
                      ? `Staff · ${entry.actorInitials}`
                      : "Staff"
                    : entry.actorType === "customer"
                      ? "Customer"
                      : entry.actorType.replace("system:", "System · ")}
                </p>
              </div>
              <time
                dateTime={entry.createdAt.toISOString()}
                className="text-ink-subtle shrink-0 text-xs tabular-nums"
              >
                {formatStoreDate(formatInTimeZone(entry.createdAt, timeZone, "yyyy-MM-dd"), "medium")}{" "}
                {formatInTimeZone(entry.createdAt, timeZone, "h:mm a")}
              </time>
            </li>
          ))}
        </ol>
      )}

      {(page > 1 || hasNext) ? (
        <nav aria-label="Pages" className="flex justify-between">
          {page > 1 ? (
            <a href={pageHref(page - 1)} className="btn btn-secondary btn-sm">Newer</a>
          ) : <span />}
          {hasNext ? (
            <a href={pageHref(page + 1)} className="btn btn-secondary btn-sm">Older</a>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

function describeAction(action: string): string {
  switch (action) {
    case "order.status_changed": return "Order status changed";
    case "order.canceled": return "Order cancelled";
    case "order.refunded": return "Refund issued";
    case "order.pickup_verified": return "Pickup verified";
    case "product.86ed": return "Item marked sold out";
    case "product.86_removed": return "Sold-out lifted";
    case "ordering.paused": return "Ordering paused";
    case "ordering.resumed": return "Ordering resumed";
    case "staff.added": return "Staff member added";
    case "staff.updated": return "Staff member updated";
    case "staff.deactivated": return "Staff member deactivated";
    case "staff.reactivated": return "Staff member reactivated";
    default: return action;
  }
}

function describeMetadata(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return "";
  const data = metadata as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof data.orderNumber === "string") parts.push(data.orderNumber);
  if (typeof data.from === "string" && typeof data.to === "string") parts.push(`${data.from} → ${data.to}`);
  if (typeof data.amountCents === "number") parts.push(`$${(data.amountCents / 100).toFixed(2)}`);
  if (typeof data.date === "string") parts.push(`for ${data.date}`);
  if (typeof data.reason === "string" && data.reason) parts.push(`— ${data.reason}`);
  if (typeof data.note === "string" && data.note) parts.push(`— ${data.note}`);
  if (typeof data.name === "string") parts.push(data.name);
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}
