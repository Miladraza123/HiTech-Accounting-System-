// HiTech Service Worker — Phase 18 Part A.3 (PWA caching).
//
// Strategy:
//   - HTML navigations: network-first (always try the network first so a
//     signed-in user always sees fresh data/permissions; fall back to the
//     cache, then a static offline page, only when genuinely offline).
//   - Static assets (Next's /_next/static/* build output, icons, fonts,
//     images): cache-first with a background refresh
//     (stale-while-revalidate) — instant load from cache, silently
//     re-fetches in the background to keep the cache warm for next time.
//   - Everything else — any non-GET request (Server Actions, RPC calls),
//     any cross-origin request (Supabase REST/Auth/Storage), and any GET
//     that isn't a navigation or a recognized static asset — is NEVER
//     intercepted or cached. Business data must always be live; caching a
//     list of invoices or a stock balance would risk showing stale
//     accounting figures.
//
// Versioned cache: bump CACHE_VERSION whenever the strategy changes.
// `activate` deletes every cache from an older version so nothing stale
// ever lingers on a user's device across deploys.
//
// v2 -> v3: no strategy change here — bumped purely so this file's own
// bytes differ, which is what actually makes an already-INSTALLED PWA
// notice there's an update at all (see ServiceWorkerRegister.tsx). The
// two real bug fixes that motivated this bump (proxy.ts's /api/ping
// exclusion, and the AbortController fix in OfflineQueueProvider.tsx)
// only touched app code, not this file — so without this bump, someone
// who already has the app installed would never see the "new version
// available" toast at all, no matter how many times they closed and
// reopened it, and would keep running the old, broken JS indefinitely.
//
// v3 -> v4: same reason again, covering everything since v3 — the
// periodic/visibilitychange update-check itself, the Offline banner's
// failure-reason text, and the buildVersion tag used to directly verify
// which commit a given device is actually running.
const CACHE_VERSION = "v4";
const CACHE_NAME = `hitech-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE_URLS = [OFFLINE_URL, "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Lets a page tell a waiting worker to activate immediately — used by the
// "Update available" toast's "Refresh" button so the user controls when
// the reload happens, instead of it happening silently underneath them.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    /\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Never touch anything but a plain GET — Server Actions and Supabase RPC
  // calls are POSTs and must always go straight to the network.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never intercept a cross-origin request (Supabase's REST/Auth/Storage
  // API lives on a different origin than this app).
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
  // Anything else (same-origin API-shaped GETs, etc.) is left completely
  // alone — no caching, straight to the network, exactly as if this
  // service worker didn't exist.
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    return offline ?? Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached ?? (await fetchPromise) ?? Response.error();
}
