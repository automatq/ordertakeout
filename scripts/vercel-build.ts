/**
 * Build the app first, then make the production database match this release.
 *
 * Vercel Sensitive variables are deliberately unreadable to the local CLI, so
 * the only safe place to run this release-bound migration is its production
 * build. The session advisory lock serializes Vercel production builds; the
 * existing migration ledger and atomic backfill make a retry idempotent.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import postgres from "postgres";

const PRODUCTION_PROJECT_ID = "prj_siaBRUXE30cdFEsDC3N6Qjbj8SMn";
const DEPLOY_LOCK_KEY = "harina:vercel-production-migration:v1";

type Environment = Readonly<Record<string, string | undefined>>;

export function shouldRunProductionDatabaseSteps(env: Environment): boolean {
  return env.VERCEL_ENV === "production";
}

export function assertProductionProject(env: Environment): void {
  if (env.VERCEL_PROJECT_ID !== PRODUCTION_PROJECT_ID) {
    throw new Error("Refusing production database migration from an unexpected Vercel project.");
  }
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for the production database migration.");
  }
}

function runNpm(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(command, args, { cwd: process.cwd(), env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(" ")} failed (${signal ?? `exit ${code ?? "unknown"}`}).`));
    });
  });
}

export async function runVercelBuild(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  // A failing compile must never mutate production data.
  await runNpm(["run", "build"], env);
  if (!shouldRunProductionDatabaseSteps(env)) return;

  assertProductionProject(env);
  const sql = postgres(env.DATABASE_URL!, { max: 1, prepare: false });
  let locked = false;
  try {
    await sql`select pg_advisory_lock(hashtext(${DEPLOY_LOCK_KEY})::bigint)`;
    locked = true;
    await runNpm(["run", "db:migrate"], env);
    await runNpm(["run", "db:backfill-legacy-location"], env);
  } finally {
    if (locked) await sql`select pg_advisory_unlock(hashtext(${DEPLOY_LOCK_KEY})::bigint)`;
    await sql.end({ timeout: 10 });
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entrypoint === import.meta.url) {
  runVercelBuild().catch((cause) => {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  });
}
