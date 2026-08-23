"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

import { changeOrderStatus, refreshDashboard } from "@/app/actions/staff";
import { NotificationBell } from "@/components/staff/notification-bell";
import { PickupVerificationDialog } from "@/components/staff/pickup-verification-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import {
  AlertIcon,
  BellIcon,
  BellOffIcon,
  LoafIcon,
  PhoneIcon,
  PrinterIcon,
} from "@/components/ui/icons";
import type { OrderStatus } from "@/lib/db/schema";
import type { DashboardData, DashboardOrder } from "@/lib/orders/dashboard";
import { dismissVisibleUnread } from "@/lib/orders/unread";
import {
  ACTION_LABEL,
  BADGE_CLASS,
  STAFF_TRANSITIONS,
  STATUS_EDGE,
  STATUS_LABEL,
} from "@/lib/orders/status";
import { formatPickupTime, formatStoreDate } from "@/lib/scheduling/time";
import { formatMoney } from "@/lib/square/money";

import { isChimeReady, playChime, primeChime } from "./chime";

/**
 * The kitchen order queue.
 *
 * What changed:
 *
 *  - Urgency is visible. Every card was identical white-on-cream regardless of
 *    status, so a paid-but-unstarted order twenty minutes from pickup looked
 *    exactly like a finished one two days out. Cards now carry the status edge
 *    the prep timeline always had (lifted to lib/orders/status.ts, where both
 *    screens can share one definition) and genuinely new orders pulse.
 *  - Pending state is per order. `disabled={isPending}` froze every button on
 *    the board while any one transition was in flight, with no spinner and no
 *    label change — one tap and the whole screen went half-transparent.
 *  - Cancelling asks first. It was a `btn-secondary` sitting two millimetres
 *    from "Mark ready", and `canceled` is terminal with no undo path.
 *  - Money stopped wearing the "ready" badge. The green PAID pill sat directly
 *    beside the green *status* pill, which is the one thing on this screen that
 *    has to be unambiguous at a glance.
 */

const POLL_INTERVAL_MS = 15_000;
const UNREAD_KEY = "staff-order-unread-v1";
const LAST_CHECKED_KEY = "staff-order-last-checked-v1";

/** Pickup this close counts as imminent, and the card says so. */
const SOON_MINUTES = 60;

function displayRefundFailure(error: string): string {
  if (error.startsWith("PARTIAL_REFUND_REQUIRES_MANUAL:")) {
    return "Square recorded a partial refund. Reconcile the remaining balance in Square before changing this order.";
  }
  return error;
}

export function OrderQueue({
  initialData,
  timeZone,
}: {
  initialData: DashboardData;
  /** The store's IANA zone, so "in 20 min" means the shop's clock. */
  timeZone: string;
}) {
  const [data, setData] = useState(initialData);
  const [soundOn, setSoundOn] = useState(false);
  const [locationFilter, setLocationFilter] = useState("all");
  const [pollError, setPollError] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [transitionNotice, setTransitionNotice] = useState<string | null>(null);
  const [squareWarning, setSquareWarning] = useState<string | null>(null);
  const [pickupDialogOpen, setPickupDialogOpen] = useState(false);
  const [updatedAge, setUpdatedAge] = useState("Loaded from the server");
  const lastUpdatedAt = useRef<number | null>(null);
  /** Which order is mid-transition, so only its buttons go busy. */
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Which orders we've already seen, so the chime fires once per new order and
  // not on every poll.
  const seenOrderIds = useRef<Set<string>>(
    new Set(initialData.days.flatMap((d) => d.slots.flatMap((s) => s.orders.map((o) => o.id)))),
  );
  /** Orders that arrived while this tab was open — highlighted until acted on. */
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  /** So the notification bell can scroll a specific card into view on click. */
  const cardRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  // Preserve unread alerts across reloads on this staff device. Orders created
  // after the last successful dashboard read are included even if the tab was
  // closed when they arrived.
  useEffect(() => {
    const allOrders = initialData.days.flatMap((day) =>
      day.slots.flatMap((slot) => slot.orders),
    );
    try {
      const storedIds: unknown = JSON.parse(localStorage.getItem(UNREAD_KEY) ?? "[]");
      const lastChecked = Number(localStorage.getItem(LAST_CHECKED_KEY) ?? Date.now());
      const validIds = new Set(allOrders.map((order) => order.id));
      const restored = Array.isArray(storedIds)
        ? storedIds.filter((id): id is string => typeof id === "string" && validIds.has(id))
        : [];
      const missed = allOrders
        .filter((order) => order.status === "paid" && new Date(order.createdAt).getTime() > lastChecked)
        .map((order) => order.id);
      queueMicrotask(() => setFreshIds(new Set([...restored, ...missed])));
      localStorage.setItem(LAST_CHECKED_KEY, String(Date.now()));
    } catch {
      // Storage is optional; the live-session bell still works without it.
    }
  }, [initialData]);

  useEffect(() => {
    try {
      localStorage.setItem(UNREAD_KEY, JSON.stringify([...freshIds]));
    } catch {}
  }, [freshIds]);

  const poll = useCallback(async () => {
    try {
      const next = await refreshDashboard();
      const incoming = next.days.flatMap((d) => d.slots.flatMap((s) => s.orders));
      const fresh = incoming.filter((o) => !seenOrderIds.current.has(o.id));

      if (fresh.length > 0) {
        for (const order of fresh) seenOrderIds.current.add(order.id);
        setFreshIds((current) => new Set([...current, ...fresh.map((o) => o.id)]));
        playChime();
      }
      setData(next);
      lastUpdatedAt.current = Date.now();
      setUpdatedAge("Updated just now");
      try { localStorage.setItem(LAST_CHECKED_KEY, String(Date.now())); } catch {}
      setPollError(null);
    } catch {
      // A dropped poll is not worth shouting about; the next one usually works.
      setPollError("Couldn't refresh. Retrying automatically…");
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (lastUpdatedAt.current !== null) {
        setUpdatedAge(describeRefreshAge(Date.now() - lastUpdatedAt.current));
      }
    }, 5_000);
    return () => clearInterval(timer);
  }, []);

  function handleTransition(orderId: string, status: OrderStatus) {
    setPendingOrderId(orderId);
    setTransitionNotice(null);
    startTransition(async () => {
      try {
        const result = await changeOrderStatus({ orderId, status });

        if (!result.ok) {
          setTransitionError(result.reason);
          return;
        }

        setTransitionError(null);
        setTransitionNotice(result.notice ?? null);
        setSquareWarning(result.squareWarning ?? null);

        // Acting on an order clears its "new" highlight only after it succeeds.
        setFreshIds((current) => {
          if (!current.has(orderId)) return current;
          const next = new Set(current);
          next.delete(orderId);
          return next;
        });

        await poll();
      } catch {
        setTransitionError("That status change didn't save. Check the connection and try again.");
      } finally {
        setPendingOrderId(null);
      }
    });
  }

  const locationOptions = data.locations.map((location) => [location.id, location.name] as const);
  const visibleDays = data.days.map((day) => {
    const slots = day.slots
      .map((slot) => ({ ...slot, orders: locationFilter === "all" ? slot.orders : slot.orders.filter((order) => order.squareLocationId === locationFilter) }))
      .filter((slot) => slot.orders.length > 0);
    return { ...day, slots, orderCount: slots.reduce((sum, slot) => sum + slot.orders.length, 0) };
  }).filter((day) => day.orderCount > 0);
  const hasOrders = visibleDays.length > 0;
  const visibleNewOrderCount = visibleDays.flatMap((day) =>
    day.slots.flatMap((slot) => slot.orders),
  ).filter((order) => order.status === "paid").length;

  const freshOrders = visibleDays
    .flatMap((day) => day.slots.flatMap((slot) => slot.orders))
    .filter((order) => freshIds.has(order.id));

  function jumpToOrder(orderId: string) {
    const card = cardRefs.current.get(orderId);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    // Momentary ring rather than relying on scroll position alone — the card
    // this lands on already carries the "new" pulse, which is easy to miss if
    // several other cards on screen are pulsing too.
    card.focus({ preventScroll: true });
  }

  function renderOrderCard(order: DashboardOrder) {
    return (
      <OrderCard
        key={order.id}
        order={order}
        isToday={order.pickupDate === data.today}
        isFresh={freshIds.has(order.id)}
        timeZone={timeZone}
        pending={pendingOrderId === order.id}
        onTransition={handleTransition}
        onVerifyPickup={() => setPickupDialogOpen(true)}
        cardRef={(node) => {
          if (node) cardRefs.current.set(order.id, node);
          else cardRefs.current.delete(order.id);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {pickupDialogOpen ? (
        <PickupVerificationDialog
          onClose={() => setPickupDialogOpen(false)}
          onVerified={async (verified) => {
            setTransitionError(null);
            setTransitionNotice(`${verified.orderNumber} was verified as picked up.`);
            setFreshIds((current) => {
              if (!current.has(verified.orderId)) return current;
              const next = new Set(current);
              next.delete(verified.orderId);
              return next;
            });
            await poll();
          }}
        />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-ink text-display-md font-normal uppercase">
            Upcoming orders
          </h1>
          {visibleNewOrderCount > 0 ? (
            <span className="badge badge-new" aria-live="polite">
              {visibleNewOrderCount} not started
            </span>
          ) : null}
          <span className="text-ink-subtle text-xs" aria-live="polite">{updatedAge}</span>
        </div>
        <label className="sr-only" htmlFor="staff-location-filter">Order location</label>
        <select id="staff-location-filter" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} className="input w-auto py-1.5 text-sm">
          <option value="all">All locations</option>
          {locationOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <button
          type="button"
          onClick={() => setSoundOn(primeChime() && isChimeReady())}
          aria-pressed={soundOn}
          className={`btn btn-sm ${soundOn ? "btn-outline" : "btn-secondary"}`}
        >
          {soundOn ? <BellIcon className="h-4 w-4" /> : <BellOffIcon className="h-4 w-4" />}
          {soundOn ? "Sound on" : "Enable sound"}
        </button>
        <NotificationBell
          orders={freshOrders}
          onDismissAll={() => setFreshIds((current) => dismissVisibleUnread(
            current,
            freshOrders.map((order) => order.id),
          ))}
          onJumpTo={(orderId) => { jumpToOrder(orderId); setFreshIds((current) => { const next = new Set(current); next.delete(orderId); return next; }); }}
        />
      </div>

      {/* Polling, local transitions and Square sync are separate failures with
          different consequences, so one successful poll never erases a failed
          kitchen action or a Square warning. */}
      {pollError ? (
        <p role="status" className="panel text-warning flex items-center gap-2 p-3 text-sm print:hidden">
          <AlertIcon className="h-4 w-4 shrink-0" />
          {pollError}
        </p>
      ) : null}
      {transitionError ? (
        <p role="alert" className="panel border-danger/30 text-danger flex items-center gap-2 p-3 text-sm print:hidden">
          <AlertIcon className="h-4 w-4 shrink-0" />
          {transitionError}
        </p>
      ) : null}
      {transitionNotice ? (
        <div role="status" className="panel text-warning flex flex-wrap items-center gap-2 p-3 text-sm print:hidden">
          <AlertIcon className="h-4 w-4 shrink-0" />
          <span className="flex-1">{transitionNotice}</span>
          <button type="button" onClick={() => setTransitionNotice(null)} className="btn btn-ghost btn-sm">Dismiss</button>
        </div>
      ) : null}
      {squareWarning ? (
        <div role="alert" className="panel text-warning flex flex-wrap items-center gap-2 p-3 text-sm print:hidden">
          <AlertIcon className="h-4 w-4 shrink-0" />
          <span className="flex-1">Order status saved here, but Square still needs attention: {squareWarning}</span>
          <button type="button" onClick={() => setSquareWarning(null)} className="btn btn-ghost btn-sm">Dismiss</button>
        </div>
      ) : null}

      {!hasOrders ? (
        <EmptyState
          icon={<LoafIcon className="h-6 w-6" />}
          title="No upcoming orders"
          description="Nothing is booked for the next week. New orders appear here automatically."
        />
      ) : (
        visibleDays.map((day) => (
          <section key={day.date} className="flex flex-col gap-3">
            {/* Sticky, so scrolling through a busy week never leaves you
                wondering which day you're looking at. */}
            <div className="bg-canvas/95 sticky top-14 z-10 flex items-baseline justify-between gap-3 py-2 backdrop-blur-sm">
              <h2 className="text-ink text-lg font-semibold">
                {formatDayHeading(day.date, data.today)}
              </h2>
              <Link
                href={`/staff/print/${day.date}${locationFilter === "all" ? "" : `?location=${encodeURIComponent(locationFilter)}`}`}
                className="text-ink-muted hover:text-brand inline-flex items-center gap-1.5 text-sm transition-colors print:hidden"
              >
                <PrinterIcon className="h-4 w-4" />
                Print prep sheet
              </Link>
            </div>

            {day.slots.map((slot) => {
              const readyOrders = slot.orders.filter((order) => order.status === "ready");
              const workOrders = slot.orders.filter((order) => order.status !== "ready");
              return (
                <div key={slot.time} className="flex flex-col gap-2">
                  <h3 className="bg-canvas/95 text-ink-subtle sticky top-28 z-5 py-2 text-sm font-semibold tracking-wide uppercase backdrop-blur-sm">
                    {formatPickupTime(slot.time)} &middot; {slot.orders.length} order
                    {slot.orders.length === 1 ? "" : "s"}
                  </h3>
                  {workOrders.length ? <ul className="flex flex-col gap-2">{workOrders.map(renderOrderCard)}</ul> : null}
                  {readyOrders.length ? (
                    <details className="panel group overflow-hidden">
                      <summary className="hover:bg-surface flex cursor-pointer items-center justify-between gap-3 p-3 text-sm font-semibold list-none">
                        <span className="text-success">Ready for pickup ({readyOrders.length})</span>
                        <span aria-hidden className="text-ink-subtle transition-transform group-open:rotate-180">▾</span>
                      </summary>
                      <ul className="flex flex-col gap-2 p-2 pt-0">{readyOrders.map(renderOrderCard)}</ul>
                    </details>
                  ) : null}
                </div>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}

function OrderCard({
  order,
  isToday,
  isFresh,
  pending,
  timeZone,
  onTransition,
  onVerifyPickup,
  cardRef,
}: {
  order: DashboardOrder;
  isToday: boolean;
  isFresh: boolean;
  pending: boolean;
  timeZone: string;
  onTransition: (orderId: string, status: OrderStatus) => void;
  onVerifyPickup: () => void;
  cardRef: (node: HTMLLIElement | null) => void;
}) {
  /** Two-step cancel: the button asks before it does anything terminal. */
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const nowMinutes = useMinuteOfDay(timeZone);
  const urgency =
    isToday && nowMinutes !== null ? describeUrgency(order.pickupTime, nowMinutes) : null;

  return (
    <li
      ref={cardRef}
      tabIndex={-1}
      className={`card flex flex-col gap-3 border-l-4 p-4 ${STATUS_EDGE[order.status]} ${
        isFresh ? "is-new" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-ink text-lg font-semibold">
            {order.orderNumber} &middot; {order.customerName}
          </span>
          <a
            href={`tel:${order.customerPhone}`}
            className="text-ink-muted hover:text-brand inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            <PhoneIcon className="h-3.5 w-3.5" />
            {order.customerPhone}
          </a>
          {order.pickupLocationName ? <span className="text-ink-subtle text-xs">{order.pickupLocationName}</span> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isFresh ? <span className="badge badge-new">New</span> : null}
          {urgency ? (
            <span className={`badge ${urgency.overdue ? "badge-new" : "badge-preparing"}`}>
              {urgency.label}
            </span>
          ) : null}
          {/* Paired with a text label, never colour alone. */}
          <span className={BADGE_CLASS[order.status]}>{STATUS_LABEL[order.status]}</span>
          {/* `.tag`, not `badge-ready`: the money chip used to be the same green
              pill as the "Ready for pickup" status sitting right next to it. */}
          <span className="tag">Paid {formatMoney(order.totalCents, order.currency)}</span>
          {order.refundStatus === "pending" ? <span className="tag tag-accent">Refund pending</span> : null}
          {order.refundStatus === "failed" ? <span className="badge badge-new">Refund failed</span> : null}
        </div>
      </div>

      <ul className="text-ink flex flex-col gap-1 text-kitchen">
        {order.items.map((item) => (
          <li key={item.id}>
            <strong className="font-semibold">{item.quantity}&times;</strong>{" "}
            {item.nameSnapshot}
          </li>
        ))}
      </ul>

      {/* The highest-consequence field on the card — allergies, a name to pipe
          on a tray — so it gets body size, not the smallest text on screen. */}
      {order.customerNote ? (
        <p
          data-print-fill
          className="bg-accent-soft text-accent-ink rounded-control px-3 py-2 text-kitchen"
        >
          <strong className="font-semibold">Note:</strong> {order.customerNote}
        </p>
      ) : null}

      {order.refundStatus === "failed" && order.refundError ? (
        <p role="alert" className="panel border-danger/30 p-3 text-sm text-danger">
          Refund failed: {displayRefundFailure(order.refundError)} Review the error before retrying.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 print:hidden">
        {order.status === "ready" ? (
          <button type="button" disabled={pending} onClick={onVerifyPickup} className="btn btn-primary btn-sm">
            Verify pickup
          </button>
        ) : null}
        {STAFF_TRANSITIONS[order.status].map((next, index) => {
          const destructive = next === "canceled";
          /* Only the next step forward is the primary. `paid` offers both
             "Start preparing" and "Mark ready"; rendering two solid brand
             buttons side by side made them compete and left the expected path
             unclear. */
          const leading = index === 0;

          if (destructive && !confirmingCancel) {
            return (
              <button
                key={next}
                type="button"
                disabled={pending}
                onClick={() => setConfirmingCancel(true)}
                className="btn btn-sm btn-danger"
              >
                {ACTION_LABEL[next] ?? next}
              </button>
            );
          }

          if (destructive) {
            return (
              <span key={next} className="flex flex-wrap items-center gap-2">
                <span className="text-ink text-sm">
                  Cancel and refund {formatMoney(order.totalCents, order.currency)}?
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setConfirmingCancel(false);
                    onTransition(order.id, next);
                  }}
                  className="btn btn-sm btn-danger"
                >
                  {pending ? <span className="spinner" aria-hidden /> : null}
                  Yes, cancel
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(false)}
                  className="btn btn-sm btn-secondary"
                >
                  Keep it
                </button>
              </span>
            );
          }

          return (
            <button
              key={next}
              type="button"
              disabled={pending}
              onClick={() => onTransition(order.id, next)}
              className={`btn btn-sm ${leading ? "btn-primary" : "btn-secondary"}`}
            >
              {pending ? <span className="spinner" aria-hidden /> : null}
              {pending ? "Saving…" : (ACTION_LABEL[next] ?? next)}
            </button>
          );
        })}
      </div>
    </li>
  );
}

/**
 * Minutes past midnight **at the store** — or null on the server.
 *
 * An external store rather than state: the clock genuinely is one, and this
 * keeps the reading out of render (which would be impure, and would disagree
 * between the server render and hydration). Null on the server means the
 * urgency badges simply don't render until the client knows the time, instead
 * of rendering a server-side guess and then correcting it.
 *
 * Formatted in the store's timezone rather than the device's. Pickup slots are
 * store wall-clock, so a tablet set to another zone would otherwise mark orders
 * overdue that aren't — or, worse, stay silent on ones that are.
 *
 * The snapshot only changes once a minute, so it's stable across re-renders
 * within a minute, which is what useSyncExternalStore requires.
 */
function subscribeToClock(onChange: () => void) {
  const timer = setInterval(onChange, 30_000);
  return () => clearInterval(timer);
}

const readServerClock = (): null => null;

function useMinuteOfDay(timeZone: string): number | null {
  const readClock = useMemo(() => {
    const format = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    });

    return () => {
      const parts = format.formatToParts(new Date());
      const hours = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
      const minutes = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
      // Intl renders midnight as "24" under hour12:false in some engines.
      return (hours % 24) * 60 + minutes;
    };
  }, [timeZone]);

  return useSyncExternalStore(subscribeToClock, readClock, readServerClock);
}

/** How close this order's pickup is, for orders due today. */
function describeUrgency(
  pickupTime: string,
  nowMinutes: number,
): { label: string; overdue: boolean } | null {
  const [hours, minutes] = pickupTime.split(":").map(Number) as [number, number];
  const minutesUntil = hours * 60 + minutes - nowMinutes;

  if (minutesUntil < 0) return { label: "Pickup passed", overdue: true };
  if (minutesUntil <= SOON_MINUTES) {
    return { label: `In ${minutesUntil} min`, overdue: minutesUntil <= 15 };
  }
  return null;
}

function formatDayHeading(date: string, today: string): string {
  const label = formatStoreDate(date, "medium");
  return date === today ? `Today · ${label}` : label;
}

function describeRefreshAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 5) return "Updated just now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `Updated ${minutes}m ago`;
}
