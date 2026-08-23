import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";

import { signOutCustomerAccount } from "@/app/actions/account";
import { getCurrentCustomerAccount, REWARD_POINTS } from "@/lib/accounts/loyalty";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { createOrderAccessToken } from "@/lib/orders/access";
import { formatMoney } from "@/lib/square/money";
import { orderItems } from "@/lib/db/schema";
import { ReorderButton } from "@/components/accounts/reorder-button";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const account = await getCurrentCustomerAccount();
  if (!account) return <main className="shell-tight py-12"><section className="card mx-auto max-w-xl rounded-[2rem] p-8 text-center"><h1 className="font-display text-4xl uppercase">Your account</h1><p className="text-ink-muted mt-3">Open a confirmed order and choose “Save my account” to access your order history and rewards.</p><Link href="/orders" className="btn btn-primary mt-6 rounded-full">Find an order</Link></section></main>;

  const history = await db().select().from(orders).where(eq(orders.customerAccountId, account.id)).orderBy(desc(orders.createdAt)).limit(30);
  const historyItems = history.length ? await db().select({ orderId: orderItems.orderId, variantId: orderItems.squareCatalogObjectId, quantity: orderItems.quantity }).from(orderItems).where(inArray(orderItems.orderId, history.map((order) => order.id))) : [];
  const itemsByOrder = new Map(history.map((order) => [order.id, historyItems.filter((item) => item.orderId === order.id)]));
  const progress = Math.min(100, Math.round((account.points / REWARD_POINTS) * 100));
  return <main className="shell-tight flex flex-col gap-8 py-8 sm:py-12">
    <header className="bg-brand text-brand-ink rounded-[2rem] px-6 py-8 sm:px-10"><p className="text-accent text-xs font-semibold tracking-[0.14em] uppercase">My account</p><h1 className="font-display text-display-lg uppercase">Welcome back, {account.name.split(" ")[0]}</h1><p className="mt-3 text-brand-ink/85">Saved orders, easy reordering, and rewards—without a password.</p></header>
    <section className="card rounded-[2rem] p-6" aria-labelledby="rewards-heading"><p className="text-brand text-xs font-semibold tracking-[0.14em] uppercase">Rewards</p><h2 id="rewards-heading" className="font-display mt-1 text-3xl uppercase">{account.points} points</h2><p className="text-ink-muted mt-2 text-sm">{account.points >= REWARD_POINTS ? "Your $10 reward is ready for checkout." : `${REWARD_POINTS - account.points} points until $10 off.`}</p><div className="bg-canvas mt-4 h-2 overflow-hidden rounded-full"><div className="bg-accent h-full rounded-full" style={{ width: `${progress}%` }} /></div></section>
    <section className="flex flex-col gap-4" aria-labelledby="orders-heading"><div className="flex items-center justify-between"><div><p className="text-brand text-xs font-semibold tracking-[0.14em] uppercase">Order history</p><h2 id="orders-heading" className="font-display text-3xl uppercase">Your orders</h2></div><Link href="/#trays" className="btn btn-outline btn-sm rounded-full">Browse trays</Link></div>{history.length ? <div className="grid gap-3">{history.map((order) => <article key={order.id} className="card flex flex-wrap items-center justify-between gap-3 rounded-[1.25rem] p-4"><div><p className="font-semibold">{order.orderNumber}</p><p className="text-ink-muted text-sm">{order.pickupDate} at {order.pickupTime} · {formatMoney(order.totalCents, order.currency)}</p></div><div className="flex gap-2"><Link className="btn btn-outline btn-sm rounded-full" href={`/orders/${order.orderNumber}?key=${encodeURIComponent(createOrderAccessToken(order.id, order.orderNumber))}`}>View</Link><ReorderButton items={itemsByOrder.get(order.id) ?? []} /></div></article>)}</div> : <p className="text-ink-muted">Your saved orders will appear here.</p>}</section>
    <form action={signOutCustomerAccount}><button className="btn btn-ghost self-start rounded-full">Sign out on this device</button></form>
  </main>;
}
