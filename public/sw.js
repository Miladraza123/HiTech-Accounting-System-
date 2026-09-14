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
//
// v4 -> v5: same reason again — OfflineQueueProvider.tsx's isOnline now
// starts optimistic instead of trusting navigator.onLine, and
// verifyRealConnectivity() gained an independent watchdog timeout so it
// can never hang indefinitely regardless of cause.
//
// v5 -> v6: an actual strategy change this time — removed the
// unconditional self.skipWaiting() from `install` (see its own comment
// below). Anyone still on v5 gets this fix via v5's own (still-buggy)
// immediate-activate behavior, one last time — from v6 onward, updates
// correctly wait for an explicit "Refresh" click instead.
//
// v6 -> v7: added the WARM_CACHE message handler below — a real,
// reported gap: the offline "create a Query/Task while offline" feature
// only ever worked if the exact page (/queries/new, /tasks/new — each a
// live Server Component fetch, not a static file) had *already* been
// successfully visited at least once, so networkFirst() had something
// cached to fall back to. Anyone who opened the app and went offline
// before ever visiting those specific pages hit the generic
// offline.html fallback instead — unable to reach the form at all, no
// matter how good the offline-queue code on that form itself is.
//
// v7 -> v8: a second real, reported-and-reproduced gap in that same
// WARM_CACHE feature — it was entirely fire-and-forget. `warmCache()`
// ran once per online transition, had no per-URL timeout (one slow
// Vercel/Supabase round trip could stall the whole batch indefinitely),
// and never told the page which of the ~23 URLs actually made it into
// the cache. A user who opened the app and went offline again within
// seconds — before that one background pass had a chance to finish —
// silently ended up with some or all of those pages never cached, with
// no retry until a whole new offline->online transition happened, and
// no way to even tell this had occurred. Reproduced end-to-end with a
// real Next.js build + real Chromium: a next/link soft navigation to an
// uncached page fails outright (its RSC fetch is invisible to this file
// — see the fetch handler's own comment below), Next's router correctly
// falls back to a real hard navigation, that hard navigation correctly
// reaches networkFirst() below — and networkFirst() correctly serves
// OFFLINE_URL when, and only when, the target page was never actually
// warmed. The fix belongs here: warmCache() now applies a per-URL
// timeout and reports back exactly which URLs succeeded/failed via
// postMessage, so OfflineQueueProvider.tsx can retry just the failures
// instead of assuming the whole pass silently succeeded.
//
// v8 -> v9: neither of the two follow-up fixes (WARM_CACHE reliability,
// then forcing a hard navigation from OfflineQueueProvider.tsx instead
// of relying on next/link's own soft-nav-failure fallback) resolved a
// real, reproduced device failure — a real device confirmed a target
// page fully warmed (24/24 in the Offline banner's own diagnostic) yet
// still hit a native browser "page couldn't load" error offline. Rather
// than propose a fourth guess, this version adds a persisted debug
// record of the last navigation this file's own fetch handler actually
// saw (see recordNavOutcome/NAV_DEBUG_URL below) — readable back from
// the app afterward — so the next real-device repro produces direct
// evidence of what this file itself did, instead of inferring it from
// symptoms two or three layers removed.
const CACHE_VERSION = "v9";
const CACHE_NAME = `hitech-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE_URLS = [OFFLINE_URL, "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
  // Deliberately no self.skipWaiting() here. Calling it unconditionally
  // on every install (including an update, not just the very first
  // install) is exactly what silently breaks the "user decides when to
  // reload" promise below: it makes the new worker activate and claim
  // every open tab almost immediately once installed, firing
  // ServiceWorkerRegister.tsx's controllerchange -> window.location.reload()
  // before that toast's "Refresh" button was ever clicked — or often
  // before it even had a chance to render. Left unconditional, this
  // meant every deploy could reload someone's tab mid-edit with zero
  // warning, silently discarding whatever they were filling in — the
  // exact failure mode the toast exists to prevent. Now the new worker
  // properly stays "waiting" (this event's default behavior) until the
  // message handler below calls skipWaiting() itself, triggered only by
  // that button.
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
//
// WARM_CACHE proactively fetches + caches a short list of pages the app
// asks for (see OfflineQueueProvider.tsx) — specifically the pages
// behind this app's offline-capable forms (Queries, Tasks and their
// "new" forms, Company Profile). Each is a live Server Component fetch,
// not a static file, so — unlike PRECACHE_URLS above, which only needs
// to run once at install — this is sent by the page itself whenever
// it's confirmed online, so a page nobody has manually opened yet still
// ends up cached (with reasonably current dropdown data — a party list,
// a query-source list) before the person actually needs it offline.
// Deliberately keyed by plain URL, sharing the exact same CACHE_NAME
// networkFirst() itself reads from — no special-casing needed there.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (event.data && event.data.type === "WARM_CACHE" && Array.isArray(event.data.urls)) {
    const replyTo = event.source;
    event.waitUntil(
      warmCache(event.data.urls).then((result) => {
        // Tell the requesting page exactly which URLs made it into the
        // cache and which didn't — a silent fire-and-forget pass is
        // exactly what let this go unnoticed for as long as it did (see
        // the v7 -> v8 comment above). `replyTo` is the specific tab/
        // client that sent this WARM_CACHE message, not a broadcast —
        // only it is waiting on this particular request.
        replyTo?.postMessage({ type: "WARM_CACHE_RESULT", ...result });
      })
    );
  }
});

// Per-URL timeout so one slow/hanging request (a cold Vercel function, a
// slow Supabase query) can never stall the rest of the batch — each URL
// settles (success or failure) within this window independent of every
// other URL, since they already run concurrently via Promise.all below.
const WARM_CACHE_URL_TIMEOUT_MS = 8000;

async function warmCache(urls) {
  const cache = await caches.open(CACHE_NAME);
  const cached = [];
  const failed = [];
  await Promise.all(
    urls.map(async (url) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WARM_CACHE_URL_TIMEOUT_MS);
      try {
        const response = await fetch(url, { credentials: "same-origin", signal: controller.signal });
        if (response && response.ok) {
          await cache.put(url, response.clone());
          cached.push(url);
        } else {
          // A non-ok response (e.g. a permission redirect for a role
          // that can't reach this page) leaves any previously-cached
          // copy untouched rather than overwriting it with something
          // wrong — but is still reported as "failed" so a caller that
          // actually expects this URL to be reachable can retry it.
          failed.push(url);
        }
      } catch {
        // Offline right now, a timeout, or some other fetch failure —
        // leave whatever's already cached (if anything) exactly as it
        // was; this is a best-effort background warm-up, never a
        // user-facing action that needs its own error handling. Still
        // reported as failed so the caller can decide whether to retry.
        failed.push(url);
      } finally {
        clearTimeout(timer);
      }
    })
  );
  return { cached, failed };
}

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
    // Records that this event fired at all — a persisted, readable trail
    // (see recordNavOutcome below) proving whether the service worker's
    // fetch handler was even invoked for a given real-device navigation,
    // independent of what networkFirst() itself then decides. Two prior
    // fixes (WARM_CACHE reliability, then forcing a hard navigation
    // instead of relying on next/link's soft-nav fallback) did not
    // resolve a real, reproduced device failure — this exists to stop
    // guessing at the next layer down and see the SW's own actual
    // decision directly.
    event.waitUntil(recordNavOutcome(request.url, "fetch-event-fired", {}));
    event.respondWith(networkFirst(request, event));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
  // Anything else (same-origin API-shaped GETs, etc.) is left completely
  // alone — no caching, straight to the network, exactly as if this
  // service worker didn't exist.
});

// Persists a small JSON debug record of the last navigation this service
// worker actually saw, keyed under a fixed URL inside the SAME versioned
// cache networkFirst() itself uses — deliberately NOT in-memory (a service
// worker can be terminated and respawned between events, losing in-memory
// state) and deliberately NOT gated behind any success/failure condition,
// so it survives exactly the failed-page -> Back sequence a real device
// report walks through, and can be read back afterward from the app (see
// OfflineQueueProvider.tsx). Best-effort only — must never affect the real
// navigation's own outcome.
const NAV_DEBUG_URL = "/__debug/last-nav";
async function recordNavOutcome(url, outcome, extra) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const body = JSON.stringify({ url, outcome, extra, cacheVersion: CACHE_VERSION, at: new Date().toISOString() });
    await cache.put(NAV_DEBUG_URL, new Response(body, { headers: { "Content-Type": "application/json" } }));
  } catch {
    // Never let debug logging itself break a real navigation.
  }
}

async function networkFirst(request, event) {
  // The debug write is always handed to event.waitUntil() rather than
  // awaited inline — it must never add latency to the actual navigation
  // response, only be guaranteed to finish before the browser can
  // terminate this service worker event.
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    event.waitUntil(recordNavOutcome(request.url, "network", { status: response?.status, ok: response?.ok }));
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) {
      event.waitUntil(recordNavOutcome(request.url, "cache-hit", { fetchError: String(err) }));
      return cached;
    }
    const offline = await caches.match(OFFLINE_URL);
    event.waitUntil(
      recordNavOutcome(request.url, offline ? "offline-fallback" : "response-error-no-offline-cached", {
        fetchError: String(err),
      })
    );
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
