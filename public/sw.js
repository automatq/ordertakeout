/*
 * Offline access to the pickup pass — and deliberately nothing else.
 *
 * The one moment offline support genuinely matters for this app is a customer
 * standing at the counter, in a shop with bad signal, needing to show the QR
 * code for an order they have already paid for. Everything else here is either
 * live (inventory, slot capacity, cutoffs, paused ordering) where serving a
 * stale answer is worse than serving none, or simply not worth the risk.
 *
 * A service worker is the most dangerous thing you can put on a commerce site:
 * a bad one pins stale JS across a deploy and breaks the shop on devices you
 * cannot reach. So this one refuses to handle anything it does not have to:
 *
 *   - GET only, so a checkout action can never be intercepted or replayed.
 *   - Same-origin only.
 *   - Page navigations only (`mode === "navigate"`), so no JS chunks, no CSS,
 *     no images and no RSC payloads are ever cached. Stale-chunk breakage is
 *     therefore impossible by construction.
 *   - Path `/orders/` only.
 *
 * Anything else returns without calling respondWith, which hands the request
 * straight back to the browser as if this worker did not exist.
 *
 * The strategy is network-first: an online customer always sees live order
 * status, and the cache is only ever consulted when the network has already
 * failed. The pass itself survives that because it is server-rendered into the
 * HTML — the QR is an inline SVG, so a cached page shows it with no JavaScript.
 */

const CACHE = "harina-pickup-pass-v1";

/** Orders retained offline. Enough for a customer with a few live orders. */
const MAX_ENTRIES = 10;

self.addEventListener("install", () => {
  // No precache: this only ever stores pages the customer has actually opened.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (request.mode !== "navigate") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/orders/")) return;

  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    // Only a real page is worth keeping; an error page offline is not better
    // than the last good one.
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
      await trim(cache);
    }
    return response;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: false });
    return cached ?? offlineResponse();
  }
}

/** Oldest-first eviction. Cache Storage preserves insertion order of keys. */
async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ENTRIES; i += 1) {
    await cache.delete(keys[i]);
  }
}

function offlineResponse() {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>Offline</title></head>` +
      `<body style="margin:0;font-family:system-ui,sans-serif;background:#f5f1e9;color:#1a1a1a">` +
      `<main style="max-width:32rem;margin:0 auto;padding:3rem 1.5rem;text-align:center">` +
      `<h1 style="font-size:1.5rem">You're offline</h1>` +
      `<p style="color:#5c5449">We couldn't reach the bakery. Open this order once while you have ` +
      `signal and your pickup pass will be available here even without a connection.</p>` +
      `</main></body></html>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
