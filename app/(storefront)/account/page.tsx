import type { Metadata } from "next";
import Link from "next/link";
import { count, desc, eq, inArray } from "drizzle-orm";

import { signOutCustomerAccount } from "@/app/actions/account";
import { PasskeyManager } from "@/components/accounts/passkey-manager";
import { ProfileForm } from "@/components/accounts/profile-form";
import { listPasskeys } from "@/lib/accounts/passkeys";
import { ReorderButton } from "@/components/accounts/reorder-button";
import { getCurrentCustomerAccount, loyaltyLedger, REWARD_POINTS } from "@/lib/accounts/loyalty";
import { db } from "@/lib/db";
import { orderItems, orders } from "@/lib/db/schema";
import { createOrderAccessToken } from "@/lib/orders/access";
import { BADGE_CLASS, STATUS_LABEL } from "@/lib/orders/status";
import { formatPickupTime, formatStoreDate } from "@/lib/scheduling/time";
import { formatMoney } from "@/lib/square/money";

export const metadata: Metadata = { title: "My account", robots: { index: false } };

const PAGE_SIZE = 15;

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const account = await getCurrentCustomerAccount();
  if (!account) return <SignedOut />;

  const passkeys = await listPasskeys(account.id);

  const { page: rawPage } = await searchParams;
  const requestedPage = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);

  const [[totals], history] = await Promise.all([
    db()
      .select({ orderCount: count() })
      .from(orders)
      .where(eq(orders.customerAccountId, account.id)),
    db()
      .select()
      .from(orders)
      .where(eq(orders.customerAccountId, account.id))
      .orderBy(desc(orders.createdAt))
      .limit(PAGE_SIZE)
      .offset((requestedPage - 1) * PAGE_SIZE),
  ]);
  const orderCount = totals?.orderCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(orderCount / PAGE_SIZE));

  const [historyItems, ledger] = await Promise.all([
    history.length
      ? db()
          .select({
            orderId: orderItems.orderId,
            name: orderItems.nameSnapshot,
            quantity: orderItems.quantity,
          })
          .from(orderItems)
          .where(inArray(orderItems.orderId, history.map((order) => order.id)))
      : Promise.resolve([]),
    loyaltyLedger(account.id),
  ]);
  const itemsByOrder = new Map<string, Array<{ name: string; quantity: number }>>();
  for (const item of historyItems) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push({ name: item.name, quantity: item.quantity });
    itemsByOrder.set(item.orderId, list);
  }

  const progress = Math.min(100, Math.round((account.points / REWARD_POINTS) * 100));

  return (
    <main className="shell-tight flex flex-col gap-8 py-8 sm:py-12">
      <header className="bg-brand text-brand-ink rounded-[2rem] px-6 py-8 sm:px-10">
        <p className="text-accent text-xs font-semibold tracking-[0.14em] uppercase">My account</p>
        <h1 className="font-display text-display-lg font-normal uppercase">
          Welcome back, {account.name.split(" ")[0]}
        </h1>
        <p className="text-brand-ink/85 mt-3">
          Saved orders, easy reordering, and rewards — without a password.
        </p>
      </header>

      <ProfileForm
        profile={{
          name: account.name,
          email: account.email,
          phone: account.phone,
          smsOptIn: account.smsOptIn,
        }}
      />

      <PasskeyManager
        passkeys={passkeys.map((passkey) => ({
          id: passkey.id,
          deviceLabel: passkey.deviceLabel,
          createdAt: passkey.createdAt.toISOString(),
          lastUsedAt: passkey.lastUsedAt?.toISOString() ?? null,
        }))}
      />

      <section className="card rounded-[2rem] p-6" aria-labelledby="rewards-heading">
        <p className="text-brand text-xs font-semibold tracking-[0.14em] uppercase">Rewards</p>
        <h2 id="rewards-heading" className="font-display mt-1 text-3xl font-normal uppercase">
          {account.points} points
        </h2>
        <p className="text-ink-muted mt-2 text-sm">
          {account.points >= REWARD_POINTS
            ? "Your $10 reward is ready — it applies at checkout."
            : `${REWARD_POINTS - account.points} points until $10 off.`}
        </p>
        <div className="bg-canvas mt-4 h-2 overflow-hidden rounded-full">
          <div className="bg-accent h-full rounded-full" style={{ width: `${progress}%` }} />
        </div>

        {ledger.length > 0 ? (
          <details className="mt-4">
            <summary className="text-ink-muted hover:text-ink cursor-pointer text-sm font-medium">
              Recent points activity
            </summary>
            <ul className="mt-3 flex flex-col gap-2">
              {ledger.map((entry) => (
                <li
                  key={entry.id}
                  className="text-ink-muted flex items-baseline justify-between gap-3 text-sm"
                >
                  <span>
                    {LEDGER_COPY[entry.kind]} · order {entry.orderNumber}
                  </span>
                  <span
                    className={`shrink-0 font-medium tabular-nums ${entry.points >= 0 ? "text-success" : "text-danger"}`}
                  >
                    {entry.points >= 0 ? "+" : ""}
                    {entry.points} pts
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="orders-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-brand text-xs font-semibold tracking-[0.14em] uppercase">
              Order history
            </p>
            <h2 id="orders-heading" className="font-display text-3xl font-normal uppercase">
              Your orders
            </h2>
          </div>
          <Link href="/#order" className="btn btn-outline btn-sm rounded-full">
            Browse the menu
          </Link>
        </div>

        {history.length ? (
          <div className="grid gap-3">
            {history.map((order) => {
              const items = itemsByOrder.get(order.id) ?? [];
              return (
                <article
                  key={order.id}
                  className="card flex flex-col gap-3 rounded-[1.5rem] p-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <p className="text-ink font-semibold">{order.orderNumber}</p>
                      <span className={BADGE_CLASS[order.status]}>{STATUS_LABEL[order.status]}</span>
                    </div>
                    <p className="text-ink shrink-0 font-semibold tabular-nums">
                      {formatMoney(order.totalCents + order.tipCents, order.currency)}
                    </p>
                  </div>

                  {items.length > 0 ? (
                    <p className="text-ink-muted text-sm">
                      {items.map((item) => `${item.quantity} × ${item.name}`).join(" · ")}
                    </p>
                  ) : null}

                  <p className="text-ink-subtle text-sm">
                    Pickup {formatStoreDate(order.pickupDate, "medium")} at{" "}
                    {formatPickupTime(order.pickupTime)}
                    {order.pickupLocationName ? ` · ${order.pickupLocationName}` : ""}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <Link
                      className="btn btn-outline btn-sm rounded-full"
                      href={`/orders/${order.orderNumber}?key=${encodeURIComponent(createOrderAccessToken(order.id, order.orderNumber))}`}
                    >
                      View order
                    </Link>
                    <ReorderButton orderId={order.id} />
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="text-ink-muted">
            {requestedPage > 1 ? "No orders on this page." : "Your saved orders will appear here."}
          </p>
        )}

        {pageCount > 1 ? (
          <nav aria-label="Order history pages" className="flex items-center justify-between">
            {requestedPage > 1 ? (
              <Link href={`/account?page=${requestedPage - 1}`} className="btn btn-ghost btn-sm rounded-full">
                Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-ink-subtle text-sm">
              Page {Math.min(requestedPage, pageCount)} of {pageCount}
            </span>
            {requestedPage < pageCount ? (
              <Link href={`/account?page=${requestedPage + 1}`} className="btn btn-ghost btn-sm rounded-full">
                Older
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>

      <form action={signOutCustomerAccount}>
        <button className="btn btn-ghost self-start rounded-full">Sign out on this device</button>
      </form>
    </main>
  );
}

const LEDGER_COPY: Record<"earned" | "redeemed" | "reversed" | "revoked", string> = {
  earned: "Points earned",
  redeemed: "Reward redeemed",
  reversed: "Points returned after cancellation",
  revoked: "Points reversed after refund",
};

function SignedOut() {
  return (
    <main className="shell-tight py-12">
      <section className="card mx-auto flex max-w-xl flex-col gap-5 rounded-[2rem] p-8 text-center">
        <h1 className="font-display text-ink text-4xl font-normal uppercase">Your account</h1>
        <p className="text-ink-muted">
          Sign in with your email to see your order history, reorder in a tap, and track
          rewards. No password needed.
        </p>
        <Link href="/account/sign-in" className="btn btn-primary mx-auto rounded-full">
          Sign in by email
        </Link>
        <p className="text-ink-subtle border-border border-t pt-4 text-sm">
          First time? Place an order and choose{" "}
          <strong className="text-ink font-medium">Save my account</strong> on the
          confirmation page. <Link href="/orders" className="text-brand underline">Find an order</Link>
        </p>
      </section>
    </main>
  );
}
