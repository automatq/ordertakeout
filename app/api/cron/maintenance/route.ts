import { runMaintenance } from "@/lib/maintenance";
import { serverEnv } from "@/lib/env";

export async function GET(request: Request) {
  const secret = serverEnv().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }

  return Response.json({ ok: true, ...(await runMaintenance()) });
}

