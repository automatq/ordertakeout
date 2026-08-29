/**
 * One-command demo runner: migrate, seed, serve.
 *
 * Exists because neither drizzle-kit nor tsx reads `.env.local` — only Next does.
 * Without this, `npm run demo` fails on the migrate step with an unhelpful
 * "url: undefined", which is a miserable first five minutes for anyone trying
 * the project.
 */

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";

const ENV_FILE = ".env.local";
const TEMPLATE = ".env.demo";

if (!existsSync(ENV_FILE)) {
  if (!existsSync(TEMPLATE)) {
    console.error(`Missing ${ENV_FILE} and ${TEMPLATE}. See the README.`);
    process.exit(1);
  }
  copyFileSync(TEMPLATE, ENV_FILE);
  console.log(`Created ${ENV_FILE} from ${TEMPLATE}.`);
}

/** Minimal KEY=VALUE parser — enough for the demo template, not a dotenv clone. */
function readEnvFile(path) {
  const parsed = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    parsed[key] = value;
  }
  return parsed;
}

// Real environment wins, so `DATABASE_URL=... npm run demo` overrides the file.
const env = { ...readEnvFile(ENV_FILE), ...process.env };

if (!env.DATABASE_URL) {
  console.error(`No DATABASE_URL in ${ENV_FILE}. Set it to a Postgres you can reach.`);
  process.exit(1);
}

function run(command, args, { inherit = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: inherit ? "inherit" : "pipe", env, shell: false });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`)),
    );
  });
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

try {
  /* The demo starts `next dev` directly, so npm's predev hook never fires and
     the staff QR scanner's WASM decoder would be missing from public/. */
  await run(process.execPath, ["scripts/copy-barcode-wasm.mjs"]);

  console.log("\n▸ Applying migrations…");
  await run(npx, ["drizzle-kit", "migrate"]);

  console.log("\n▸ Seeding demo data…");
  await run(npx, ["tsx", "scripts/seed-demo.ts"]);

  const port = env.PORT ?? "3000";
  console.log(`\n▸ Starting the demo on http://localhost:${port}`);
  console.log(`  Storefront  http://localhost:${port}/`);
  console.log(`  Staff       http://localhost:${port}/staff  (password: ${env.STAFF_DASHBOARD_PASSWORD})\n`);

  await run(npx, ["next", "dev", "--port", port]);
} catch (error) {
  console.error(`\n${error.message}`);
  if (String(error.message).includes("drizzle-kit")) {
    console.error(
      `Could not reach ${env.DATABASE_URL.replace(/:\/\/[^@]*@/, "://***@")}. Is Postgres running?`,
    );
  }
  process.exit(1);
}
