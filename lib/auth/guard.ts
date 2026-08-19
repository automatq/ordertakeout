import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { serverEnv } from "@/lib/env";

import { SESSION_COOKIE, verifySessionToken } from "./session";

/**
 * The staff authorization check.
 *
 * Called by the protected layout *and* by every staff server action. Both are
 * necessary: a layout guard stops the page rendering, but server actions are
 * independently addressable endpoints — anyone who knows an action's id can
 * invoke it directly, so a page-level check alone would leave them open.
 */
export async function hasStaffSession(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(serverEnv().STAFF_DASHBOARD_PASSWORD, token);
}

export async function requireStaffSession(): Promise<void> {
  if (!(await hasStaffSession())) {
    redirect("/staff/login");
  }
}
