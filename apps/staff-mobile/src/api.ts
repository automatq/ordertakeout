import { Platform } from "react-native";
import * as Device from "expo-device";

import { theme } from "./theme";

/**
 * The one place that talks to the server.
 *
 * Every call returns a Result rather than throwing. A counter tablet loses Wi-Fi
 * regularly, and a thrown fetch error two components deep becomes a blank screen
 * mid-shift; a value the caller has to look at becomes a message on the queue.
 */

const BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; unauthorized?: boolean };

export interface QueueOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string | null;
  pickupDate: string;
  pickupTime: string;
  status: string;
  totalCents: number;
  currency: string;
  customerNote: string | null;
  staffNote: string | null;
  locationName: string | null;
  items: { name: string; quantity: number }[];
  verifiedAt: string | null;
}

export interface QueueDay {
  date: string;
  orderCount: number;
  slots: { time: string; capacity: number; orders: QueueOrder[] }[];
}

export interface Queue {
  today: string;
  newOrderCount: number;
  days: QueueDay[];
}

async function request<T>(path: string, init: RequestInit = {}): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/api/v1${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      /* A kitchen tablet on bad Wi-Fi should say so in a few seconds rather than
         spin until the OS gives up. */
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    return {
      ok: false,
      error: timedOut ? "The shop's server didn't answer." : "No connection.",
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: "The server sent something unexpected." };
  }

  const envelope = body as { ok?: boolean; data?: T; error?: { message?: string } };
  if (!envelope.ok) {
    return {
      ok: false,
      error: envelope.error?.message ?? "Something went wrong.",
      /* Surfaced separately so the app can drop a dead token and show the login
         screen, rather than showing "Sign in again" over an empty queue. */
      unauthorized: response.status === 401,
    };
  }
  return { ok: true, data: envelope.data as T };
}

/**
 * Sign in, naming this handset so it can be revoked on its own later.
 *
 * The label is only ever read by a person deciding which device to cut off, and
 * "iPhone" three times over makes that decision impossible. `Device.deviceName`
 * is what the owner called it — "Ana's iPhone", "Counter iPad" — which is
 * exactly the distinguishing detail needed. It falls back to something with the
 * platform in it rather than nothing.
 */
export const signIn = (password: string) =>
  request<{ token: string; expiresInSeconds: number }>("/staff/session", {
    method: "POST",
    body: JSON.stringify({
      password,
      deviceLabel: deviceLabel(),
      platform: Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : undefined,
    }),
  });

function deviceLabel(): string {
  const name = Device.deviceName?.trim();
  if (name) return name.slice(0, 60);
  const model = Device.modelName?.trim();
  return (model ? `${model} (unnamed)` : `${Platform.OS} device`).slice(0, 60);
}

export const fetchQueue = (token: string) =>
  request<Queue>("/staff/orders", { headers: { Authorization: `Bearer ${token}` } });

export const apiBase = BASE;
export const accent = theme.brand;
