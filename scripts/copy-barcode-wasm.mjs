/**
 * Keep public/wasm/zxing_reader.wasm in step with the installed package.
 *
 * The staff QR scanner falls back to a WASM decoder on browsers without
 * BarcodeDetector. Serving it from our own origin rather than a CDN keeps the
 * request inside the CSP's connect-src and removes a third-party dependency
 * from a counter workflow — but it means the copy has to be refreshed whenever
 * @sec-ant/zxing-wasm moves, which is what this does.
 *
 * Idempotent and quiet: it only writes when the bytes differ.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/@sec-ant/zxing-wasm/dist/reader/zxing_reader.wasm");
const target = resolve(root, "public/wasm/zxing_reader.wasm");

const digest = (path) => {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
};

const from = digest(source);
if (!from) {
  console.error("[barcode-wasm] source missing — is @sec-ant/zxing-wasm installed?");
  process.exit(1);
}

if (from === digest(target)) process.exit(0);

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log("[barcode-wasm] refreshed public/wasm/zxing_reader.wasm");
