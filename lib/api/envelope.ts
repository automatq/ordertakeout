import { NextResponse } from "next/server";

/**
 * One response shape for every /api/v1 route.
 *
 * The server actions this wraps return four different failure shapes — bare
 * `{ ok: false, error }`, `{ ok: false, problem: { kind } }`, thrown redirects,
 * and field-level `fieldErrors` maps. A phone should not have to know about any
 * of that, so the normalising happens here, at the boundary, and nothing in
 * lib/ changes.
 */

export type ApiError =
  | "unauthorized"
  | "invalid_request"
  | "rate_limited"
  | "unavailable";

const STATUS: Record<ApiError, number> = {
  unauthorized: 401,
  invalid_request: 400,
  rate_limited: 429,
  unavailable: 503,
};

export function ok<T>(data: T): NextResponse {
  return NextResponse.json({ ok: true, data });
}

export function fail(code: ApiError, message: string): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message } }, { status: STATUS[code] });
}

/**
 * The 401 every authenticated route returns.
 *
 * Byte-identical whether the header was missing, malformed, expired or forged —
 * a client that can tell those apart can probe for valid token shapes.
 */
export const unauthorized = () => fail("unauthorized", "Sign in again.");
