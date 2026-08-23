import { runFastMaintenance, runMaintenance } from "@/lib/maintenance";
import { serverEnv } from "@/lib/env";

/**
 * Two schedules share this endpoint: Vercel's daily Hobby cron runs the full
 * pass (pruning + PII retention included), and a GitHub Actions schedule calls
 * `?scope=fast` every few minutes for the jobs that can't wait a day —
 * notification retries, stale payment recovery, Square-sync retries.
 */
export async function GET(request: Request) {
  // Read the request BEFORE serverEnv(): touching request data is what bails
  // this handler out of build-time prerendering. With the env read first, an
  // env-less build (CI) throws inside the prerender pass and fails the build
  // before ever reaching the request.
  const authorization = request.headers.get("authorization");
  const secret = serverEnv().CRON_SECRET;
  if (!secret || authorization !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const fast = new URL(request.url).searchParams.get("scope") === "fast";
  const result = fast ? await runFastMaintenance() : await runMaintenance();
  return Response.json({ ok: true, scope: fast ? "fast" : "full", ...result });
}
