"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { changeOrderStatus, refreshDashboard } from "@/app/actions/staff";
import type { DashboardData, DashboardOrder } from "@/lib/orders/dashboard";
import type { OrderStatus } from "@/lib/db/schema";
import { ACTION_LABEL, STAFF_TRANSITIONS, STATUS_LABEL } from "@/lib/orders/status";
import { formatPickupTime, formatStoreDate } from "@/lib/scheduling/time";
import { formatMoney } from "@/lib/square/money";

import { isChimeReady, playChime, primeChime } from "./chime";

const POLL_INTERVAL_MS = 15_000;

const STATUS_CLASS: Record<OrderStatus, string> = {
  pending_payment: "bg-surface-sunken text-ink-subtle",
  paid: "bg-status-new-soft text-status-new",
  preparing: "bg-status-preparing-soft text-status-preparing",
  ready: "bg-status-ready-soft text-status-ready",
  completed: "bg-status-completed-soft text-status-completed",
  canceled: "bg-status-canceled-soft text-status-canceled",
};

export function OrderQueue({ initialData }: { initialData: DashboardData }) {
  const [data, setData] = useState(initialData);
  const [soundOn, setSoundOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Which orders we've already seen, so the chime fires once per new order and
  // not on every poll.
  const seenOrderIds = useRef<Set<string>>(
    new Set(initialData.days.flatMap((d) => d.slots.flatMap((s) => s.orders.map((o) => o.id)))),
  );

  const poll = useCallback(async () => {
    try {
      const next = await refreshDashboard();
      const incoming = next.days.flatMap((d) => d.slots.flatMap((s) => s.orders));
      const fresh = incoming.filter((o) => !seenOrderIds.current.has(o.id));

      if (fresh.length > 0) {
        for (const order of fresh) seenOrderIds.current.add(order.id);
        playChime();
      }
      setData(next);
      setError(null);
    } catch {
      // A dropped poll is not worth shouting about; the next one usually works.
      setError("Couldn't refresh. Retrying…");
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  function handleTransition(orderId: string, status: OrderStatus) {
    startTransition(async () => {
      const result = await changeOrderStatus({ orderId, status });
      setError(result.ok ? (result.squareWarning ?? null) : result.reason);
      await poll();
    });
  }

  const hasOrders = data.days.some((d) => d.orderCount > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-ink text-2xl font-semibold">Upcoming orders</h1>
          {data.newOrderCount > 0 ? (
            <span className="bg-status-new-soft text-status-new rounded-control px-2 py-1 text-sm font-semibold">
              {data.newOrderCount} new
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setSoundOn(primeChime() && isChimeReady())}
          className={`rounded-control border px-3 py-2 text-sm transition-colors ${
            soundOn
              ? "border-success text-success bg-surface"
              : "border-border bg-surface text-ink-muted hover:border-border-strong"
          }`}
        >
          {soundOn ? "🔔 Sound on" : "🔕 Enable sound"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-warning text-sm print:hidden">
          {error}
        </p>
      ) : null}

      {!hasOrders ? (
        <p className="text-ink-muted">No upcoming orders.</p>
      ) : (
        data.days.map((day) => (
          <section key={day.date} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-ink text-lg font-semibold">
                {formatDayHeading(day.date, data.today)}
              </h2>
              <Link
                href={`/staff/print/${day.date}`}
                className="text-ink-muted hover:text-brand text-sm transition-colors print:hidden"
              >
                Print prep sheet
              </Link>
            </div>

            {day.slots.map((slot) => (
              <div key={slot.time} className="flex flex-col gap-2">
                <h3 className="text-ink-subtle text-sm font-semibold tracking-wide uppercase">
                  {formatPickupTime(slot.time)} &middot; {slot.orders.length} order
                  {slot.orders.length === 1 ? "" : "s"}
                </h3>
                <ul className="flex flex-col gap-2">
                  {slot.orders.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      disabled={isPending}
                      onTransition={handleTransition}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}

function OrderCard({
  order,
  disabled,
  onTransition,
}: {
  order: DashboardOrder;
  disabled: boolean;
  onTransition: (orderId: string, status: OrderStatus) => void;
}) {
  return (
    <li className="rounded-card border-border bg-surface flex flex-col gap-3 border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-ink font-semibold">
            {order.orderNumber} &middot; {order.customerName}
          </span>
          <a
            href={`tel:${order.customerPhone}`}
            className="text-ink-muted hover:text-brand text-sm transition-colors"
          >
            {order.customerPhone}
          </a>
        </div>

        <div className="flex items-center gap-2">
          {/* Paired with a text label, never colour alone. */}
          <span
            className={`rounded-control px-2 py-1 text-sm font-semibold ${STATUS_CLASS[order.status]}`}
          >
            {STATUS_LABEL[order.status]}
          </span>
          <span className="bg-status-ready-soft text-status-ready rounded-control px-2 py-1 text-sm font-semibold">
            PAID {formatMoney(order.totalCents, order.currency)}
          </span>
        </div>
      </div>

      <ul className="text-ink flex flex-col gap-1 text-sm">
        {order.items.map((item) => (
          <li key={item.id}>
            <strong className="font-semibold">{item.quantity}&times;</strong>{" "}
            {item.nameSnapshot}
          </li>
        ))}
      </ul>

      {order.customerNote ? (
        <p className="bg-accent-soft text-accent-ink rounded-control px-3 py-2 text-sm">
          Note: {order.customerNote}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 print:hidden">
        {STAFF_TRANSITIONS[order.status].map((next) => (
          <button
            key={next}
            type="button"
            disabled={disabled}
            onClick={() => onTransition(order.id, next)}
            className={`rounded-control px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
              next === "canceled"
                ? "border-border text-ink-muted hover:text-danger hover:border-danger border"
                : "bg-brand text-brand-ink hover:bg-brand-hover"
            }`}
          >
            {ACTION_LABEL[next] ?? next}
          </button>
        ))}
      </div>
    </li>
  );
}

function formatDayHeading(date: string, today: string): string {
  const label = formatStoreDate(date, "medium");
  return date === today ? `Today · ${label}` : label;
}
