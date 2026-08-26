import "server-only";

import { verifySessionToken } from "@/lib/auth/session";
import { serverEnv } from "@/lib/env";

/**
 * The Next-specific surface of a request, resolved one way for a bearer client.
 *
 * The web guard in lib/auth/guard.ts reads a cookie and `redirect()`s. Neither
 * works for a phone: it never sends the cookie, and a 302 to /staff/login is not
 * something a JSON client can act on. So the same token check is exposed here
 * against the Authorization header, returning a boolean instead of redirecting.
 *
 * Same token, same secret, same verification — only the transport differs. That
 * matters: it means there is one definition of "signed in as staff" rather than
 * two that can drift apart.
 */
export async function hasStaffBearer(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization");
  if (!header) return false;

  /* Case-insensitive scheme, exactly one space: some HTTP clients send "bearer".
     Anything else is malformed rather than merely wrong, and is rejected the
     same way so neither case is distinguishable from the outside. */
  const match = /^Bearer (.+)$/i.exec(header.trim());
  if (!match) return false;

  return verifySessionToken(serverEnv().STAFF_DASHBOARD_PASSWORD, match[1]);
}
