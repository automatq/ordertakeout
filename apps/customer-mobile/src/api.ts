/**
 * The one place that talks to the shop.
 *
 * Every call returns a Result rather than throwing. A customer on a phone loses
 * signal constantly, and a thrown fetch two components deep becomes a blank
 * screen in a shop doorway.
 */

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
