/**
 * The one place that talks to the shop.
 *
 * Every call returns a Result rather than throwing. A customer on a phone loses
 * signal constantly, and a thrown fetch two components deep becomes a blank
 * screen in a shop doorway.
 */

import { isOffline } from "./online";

const BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface MenuVariant {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  /** Null means unknown — no pickup location chosen, or we are offline. */
  available: boolean | null;
}

export interface MenuProduct {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  allergens: string[];
  dietaryTags: string[];
  leadTimeDays: number;
  orderCutoffTime: string;
  variants: MenuVariant[];
}

export interface Menu {
  locationId: string | null;
  groups: { category: string; products: MenuProduct[] }[];
}

async function request<T>(path: string, init: RequestInit = {}): Promise<Result<T>> {
  /* With no network at all there is nothing to wait for, and waiting is the
     expensive part: the timeout below is ten seconds, which is ten seconds of
     spinner in a doorway before the app admits what the phone already knew. */
  if (isOffline()) return { ok: false, error: "No connection." };

  let response: Response;
  try {
    response = await fetch(`${BASE}/api/v1${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    return { ok: false, error: timedOut ? "The shop didn't answer." : "No connection." };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: "Something went wrong." };
  }

  const envelope = body as { ok?: boolean; data?: T; error?: { message?: string } };
  if (!envelope.ok) return { ok: false, error: envelope.error?.message ?? "Something went wrong." };
  return { ok: true, data: envelope.data as T };
}

/**
 * Cancel an order, on the authority of the key that reads it.
 *
 * Never retried automatically and never queued when offline: a cancellation
 * that fires twice is at best confusing and at worst a double refund. If it did
 * not go through, the customer is told, and pressing again is their call.
 */
export const cancelOrder = (orderNumber: string, key: string) =>
  request<{ canceled: true }>(`/orders/${encodeURIComponent(orderNumber)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ key }),
  });

export const fetchMenu = (locationId?: string | null) =>
  request<Menu>(`/menu${locationId ? `?locationId=${encodeURIComponent(locationId)}` : ""}`);

export const formatMoney = (cents: number, currency: string): string =>
  `${currency === "CAD" || currency === "USD" ? "$" : ""}${(cents / 100).toFixed(2)}`;

/** Cheapest variant, for the "from $X" on a menu card. */
export function fromPrice(product: MenuProduct): string | null {
  const prices = product.variants.map((variant) => variant.priceCents);
  if (prices.length === 0) return null;
  const lowest = Math.min(...prices);
  return formatMoney(lowest, product.variants[0]!.currency);
}

/**
 * What to say about whether this can be bought.
 *
 * Three states, not two. "We don't know yet" is its own answer and gets its own
 * words — a menu that quietly presents unknown as available is how somebody
 * pays for a cake the shop cannot make.
 */
export function availabilityOf(product: MenuProduct): "available" | "sold-out" | "unknown" {
  if (product.variants.some((variant) => variant.available === null)) return "unknown";
  return product.variants.some((variant) => variant.available) ? "available" : "sold-out";
}


export interface PickupShop {
  id: string;
  name: string;
  address: string;
  city: string | null;
  phone: string | null;
  coordinates: { latitude: number; longitude: number } | null;
  hours: { dayOfWeek: string; startTime: string; endTime: string }[];
}

export const fetchShops = () => request<{ shops: PickupShop[] }>("/locations");


export interface OrderLine {
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
}

export interface CustomerOrder {
  orderNumber: string;
  status: string;
  customerName: string;
  pickupDate: string;
  pickupTime: string;
  pickup: { name: string | null; address: string | null; city: string | null; phone: string | null };
  items: OrderLine[];
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  currency: string;
  customerNote: string | null;
  /** Null once there is nothing left to collect. */
  pickupPass: string | null;
  /**
   * The server's verdict on cancelling, with the reason when it says no.
   *
   * Not something the app can decide: the deadline is the earliest production
   * cutoff across the items, and the per-product lead times behind it never
   * leave the server.
   */
  cancellation: { allowed: boolean; reason: string | null };
}

export type OrderLookup =
  | { found: true; today: string; order: CustomerOrder }
  | { found: false };

/**
 * Fetch one order using the key from its confirmation link.
 *
 * Every failure — wrong key, no key, no such order — comes back as
 * `{ found: false }` with a 200, deliberately. There is nothing here for the
 * client to distinguish, and nothing it should try to.
 */
export const fetchOrder = (orderNumber: string, key: string) =>
  request<OrderLookup>(`/orders/${encodeURIComponent(orderNumber)}?key=${encodeURIComponent(key)}`);


export interface AccountOrder {
  orderNumber: string;
  status: string;
  pickupDate: string;
  pickupTime: string;
  totalCents: number;
  currency: string;
  pickupLocationName: string | null;
  items: { name: string; quantity: number }[];
}

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * Ask for a code.
 *
 * `sent` is true whether or not the number has an account — the server will not
 * say, and the app must not invent a way to find out. Both outcomes carry a
 * message written to be shown as-is.
 */
export const requestSignInCode = (phone: string) =>
  request<{ sent: boolean; message: string }>("/account/code", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });

export const openSession = (phone: string, code: string) =>
  request<{ signedIn: boolean; message?: string; token?: string }>("/account/session", {
    method: "POST",
    body: JSON.stringify({ phone, code }),
  });

export const fetchAccountOrders = (token: string) =>
  request<{ today: string; orders: AccountOrder[] }>("/account/orders", {
    headers: authed(token),
  });

/** How a points row came to exist. The wording lives on this side — see Account. */
export type RewardEntryKind = "earned" | "redeemed" | "reversed" | "revoked";

export interface RewardEntry {
  id: string;
  kind: RewardEntryKind;
  /** Positive for points gained, negative for a redemption. */
  points: number;
  orderNumber: string;
  createdAt: string;
}

export interface Rewards {
  points: number;
  /** What a reward costs, and what it is worth. Both come from the shop, never
      from a constant baked into whichever build happens to be installed. */
  rewardPoints: number;
  rewardDiscountCents: number;
  entries: RewardEntry[];
}

export const fetchAccountRewards = (token: string) =>
  request<Rewards>("/account/rewards", { headers: authed(token) });


export interface AvailabilitySlot {
  time: string;
  available: boolean;
  /** Why not, in words the counter would use. Null when it is available. */
  reason: string | null;
  remaining: number | null;
}

export interface AvailabilityDay {
  date: string;
  hasAvailability: boolean;
  slots: AvailabilitySlot[];
}

export type Availability =
  | { available: true; today: string; days: AvailabilityDay[] }
  | { available: false; reason: string };

/**
 * Pickup days and times for a cart at one shop.
 *
 * Advisory, exactly as on the web: the same rules run again inside the
 * reservation lock before anything is charged, because a slot can fill between
 * choosing it and paying for it.
 */
export const fetchAvailability = (
  locationId: string,
  cart: { variantId: string; quantity: number }[],
) =>
  request<Availability>("/availability", {
    method: "POST",
    body: JSON.stringify({ locationId, cart }),
  });
