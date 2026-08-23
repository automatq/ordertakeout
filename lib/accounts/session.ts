import "server-only";

import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { serverEnv } from "@/lib/env";

const ACCOUNT_COOKIE = "customer_account";
const ACCOUNT_TTL_MS = 180 * 24 * 60 * 60 * 1000;

function secret() {
  // Kept distinct from order tracking even where a deployment has not yet set
  // the dedicated key. The domain-separated payload prevents cross-use.
  return serverEnv().CUSTOMER_ACCOUNT_SECRET
    ?? serverEnv().ORDER_ACCESS_SECRET
    ?? serverEnv().STAFF_DASHBOARD_PASSWORD;
}

async function signature(payload: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`account:${payload}`))).toString("base64url");
}

export async function createAccountSessionToken(accountId: string, now = Date.now()) {
  const payload = `${accountId}.${now + ACCOUNT_TTL_MS}`;
  return `${payload}.${await signature(payload)}`;
}

export async function accountIdFromSession(token: string | undefined, now = Date.now()): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !/^[0-9a-f-]{36}$/i.test(parts[0] ?? "")) return null;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(await signature(payload));
  const received = Buffer.from(parts[2] ?? "");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  const expiresAt = Number(parts[1]);
  return Number.isFinite(expiresAt) && expiresAt > now ? parts[0]! : null;
}

export async function currentAccountId() {
  return accountIdFromSession((await cookies()).get(ACCOUNT_COOKIE)?.value);
}

export async function setAccountSession(accountId: string) {
  (await cookies()).set(ACCOUNT_COOKIE, await createAccountSessionToken(accountId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACCOUNT_TTL_MS / 1000,
  });
}

export async function clearAccountSession() {
  (await cookies()).delete(ACCOUNT_COOKIE);
}
