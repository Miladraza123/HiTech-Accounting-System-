"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { smartMergeUpdate, type SmartMergeConflict } from "@/lib/smartMerge";
import {
  enqueueWrite,
  flushQueue,
  listQueuedWrites,
  refreshMasterDataCache,
  type QueuedWriteInput,
  type SyncedConflict,
} from "@/lib/offlineQueue";

type OfflineQueueContextValue = {
  isOnline: boolean;
  pendingCount: number;
  enqueue: (entry: QueuedWriteInput) => Promise<void>;
};

const OfflineQueueContext = createContext<OfflineQueueContextValue | null>(null);

/**
 * Lets a free-edit form (Company Profile, Party Credit Terms) queue its
 * save for later instead of failing outright when the browser is
 * offline. Every queued write is later replayed through the exact same
 * Smart Merge RPC an online save uses (see src/lib/offlineQueue.ts), so
 * an offline edit gets the identical field-level conflict protection a
 * live edit does — never a blind overwrite once connectivity returns.
 */
export function useOfflineQueue() {
  const ctx = useContext(OfflineQueueContext);
  if (!ctx) throw new Error("useOfflineQueue must be used within OfflineQueueProvider");
  return ctx;
}

// `navigator.onLine` only reflects whether a network *interface* is up
// (Wi-Fi/cellular radio active) — not whether the device can actually
// reach anything. On some mobile carriers/proxies/VPNs it reports
// `false` with a perfectly working internet connection, which is exactly
// the case this exists to catch — so it is NEVER trusted on its own in
// either direction. This always does a real same-origin fetch and only
// that result decides the banner.
//
// Uses a manual AbortController + setTimeout for the request timeout,
// deliberately NOT the newer `AbortSignal.timeout()` combinator: on any
// browser/embedded WebView that lacks it (real gap on some older Android
// System WebView builds, which don't always track current Chrome even
// when fetch/AbortController themselves work fine), calling
// `AbortSignal.timeout(5000)` throws a synchronous TypeError while
// building the fetch options — caught by the catch below and reported as
// "offline" 100% of the time, completely independent of actual
// connectivity, on every single check. Confirmed exactly this failure
// with AbortSignal.timeout deleted in a real headless Chromium page: the
// old form throws every time; this form still fetches normally.
//
// Returns the actual failure reason alongside the boolean (rather than
// silently swallowing it) — this exact check has already been wrong for
// reasons that took multiple rounds of guessing to track down (a proxy
// redirect, a missing browser API); the next time a check fails for a
// reason nobody has seen yet, that reason needs to be visible directly
// in the banner on whatever device hits it, not invisible in a console
// nobody watching a phone has access to.
async function verifyRealConnectivity(): Promise<{ ok: boolean; reason?: string }> {
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 5000);
  let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const fetchAttempt = (async () => {
      const res = await fetch("/api/ping", { method: "GET", cache: "no-store", signal: controller.signal });
      return res.ok ? { ok: true } : { ok: false, reason: `HTTP ${res.status}` };
    })();
    // A second, independent timeout — belt and suspenders. The abort
    // above is *supposed* to always force fetch() to reject within 5s on
    // its own, but this makes that guarantee not depend on any single
    // mechanism: whichever settles first wins, so even an
    // AbortController/fetch interaction this code hasn't anticipated on
    // some browser still can't leave reconcile() waiting forever on a
    // promise that never settles — which is exactly what turns "Offline"
    // into a permanently stuck banner with no reason attached, since a
    // reason is only ever set once a check actually completes.
    const watchdog = new Promise<{ ok: boolean; reason?: string }>((resolve) => {
      watchdogTimer = setTimeout(() => resolve({ ok: false, reason: "watchdog: check never settled" }), 6000);
    });
    return await Promise.race([fetchAttempt, watchdog]);
  } catch (e) {
    const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { ok: false, reason };
  } finally {
    clearTimeout(abortTimer);
    clearTimeout(watchdogTimer);
  }
}

const RECHECK_INTERVAL_MS = 15000;

// The offline-capable "create" pages — kept as a top-level constant so the
// retry logic below (WARM_CACHE_RESULT handling) can re-send exactly the
// URLs the service worker reports as still missing, instead of re-sending
// the whole list every time.
//
// Phase 1 (Master Offline-First Roadmap): /clients, /items, and
// /setup/warehouses embed their offline-capable create forms
// (PartyForm/ItemForm/WarehouseForm) directly on the list page itself
// rather than a separate /new route — same reachability gap as
// /queries/new before this mechanism existed. Tells the service worker to
// proactively fetch + cache those specific pages itself (see WARM_CACHE in
// sw.js) whenever a real connectivity check has confirmed we're online —
// so by the time anyone actually needs one offline, it's very likely
// already sitting in cache with reasonably current dropdown data,
// regardless of what they've personally clicked on today.
//
// Phase 9: every OTHER static "create" route from Phases 2-8 had the exact
// same gap and was never added here — a genuine, previously-undiscovered
// reachability bug found by actually auditing every `useOfflineQueue`
// consumer's parent page against this list, not assumed. Added below. Two
// routes are DELIBERATELY still excluded — /quotations/new?query_id= and
// /sales-orders/new?quotation_id= — since both 404 without a specific
// parent record id in the URL; a flat URL list can't warm those
// (documented, not solved, same as every phase since Phase 2 already noted
// for this exact constraint).
const WARM_CACHE_URLS = [
  "/queries",
  "/queries/new",
  "/tasks",
  "/tasks/new",
  "/setup/company",
  "/clients",
  "/items",
  "/setup/warehouses",
  "/purchase-orders/new",
  "/supplier-bills/new",
  "/delivery-challans/new",
  "/invoices/new",
  "/payments/new",
  "/payments/new/batch",
  "/expenses/new",
  "/journal-vouchers/new",
  "/stock-transfers/new",
  "/product-templates/new",
  "/jobs/new",
  "/setup/bank-accounts",
  "/setup/petty-cash-funds",
  "/setup/expense-heads",
  "/inventory/adjustments",
  // Phase 11 addendum: embeds NewVehicleForm directly on the list page,
  // same reachability shape as /clients, /items, etc.
  "/setup/vehicles",
];

// How many additional attempts to make, within the SAME online session, at
// re-sending WARM_CACHE for whatever the service worker's own
// WARM_CACHE_RESULT ack reports as still missing — a real, reproduced gap
// found by testing this end-to-end (see sw.js's v7 -> v8 comment): the
// original warmCache() was entirely fire-and-forget, so a single transient
// failure on one of ~23 live Server Component fetches (a cold Vercel
// function, a slow Supabase query, or the user going offline again mid-pass)
// silently and permanently left that page unreachable offline until the
// next full offline->online transition — which, for someone who mostly
// stays online, might never happen again in that session. Retrying just the
// reported failures, staggered a few seconds apart, converges within one
// online session instead of depending on catching everything in one pass.
const WARM_CACHE_MAX_RETRIES = 4;
const WARM_CACHE_RETRY_DELAY_MS = 4000;

export function OfflineQueueProvider({
  children,
  buildVersion,
}: {
  children: React.ReactNode;
  // The deployed git commit's short SHA, resolved server-side (see
  // (app)/layout.tsx) from Vercel's own VERCEL_GIT_COMMIT_SHA env var —
  // not readable from a client component directly, since only
  // NEXT_PUBLIC_-prefixed vars get inlined into the browser bundle.
  // Shown alongside the Offline banner so a screenshot of it answers,
  // with certainty, whether the device showing it is even running the
  // latest deployed code at all — the single question that turned out
  // to matter most across several rounds of otherwise-unreproducible
  // reports of this banner.
  buildVersion?: string;
}) {
  // Deliberately starts optimistic (true) rather than reading
  // navigator.onLine — that flag is exactly the unreliable signal this
  // whole mechanism exists to not trust (see verifyRealConnectivity's own
  // comment). Starting from it meant the FIRST thing shown could be an
  // unverified guess: if that guess was wrong-but-happened-to-say-offline
  // and the real check below somehow never got to run even once (network
  // stack oddity, browser quirk — anything), the banner could get stuck
  // showing "Offline" with genuinely no reason attached, because a reason
  // only exists once an actual check has completed. Starting true and
  // only ever flipping false via a REAL completed check (which always
  // sets isOnline and offlineReason together, right below) makes that
  // combination structurally impossible — every "Offline" now carries a
  // reason, always, with no exception.
  const [isOnline, setIsOnline] = useState(true);
  const [offlineReason, setOfflineReason] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncedConflicts, setSyncedConflicts] = useState<SyncedConflict[]>([]);
  // Surfaces the service worker's own WARM_CACHE_RESULT ack (see sw.js and
  // the effect below) directly in the Offline banner — added specifically
  // so a real device that still fails to reach an offline-capable page
  // after a full WARM_CACHE pass produces hard, reproducible evidence (a
  // screenshot naming exactly which URLs never made it into the cache)
  // instead of another round of guessing at the cause.
  const [warmCacheStatus, setWarmCacheStatus] = useState<{ cachedCount: number; total: number; failed: string[] } | null>(
    null
  );
  // Mirrors sw.js's own persisted NAV_DEBUG_URL record — the last
  // navigation its fetch handler actually saw and what it decided to do
  // with it. Two prior fixes (WARM_CACHE reliability, then forcing a hard
  // navigation instead of relying on next/link's soft-nav-failure
  // fallback) did not resolve a real, reproduced device failure — this
  // exists to show the service worker's own decision directly on the next
  // repro instead of inferring it from symptoms two or three layers
  // removed. Read directly from Cache Storage (available to the page
  // itself, not just the service worker) — see the polling effect below.
  const [lastNavDebug, setLastNavDebug] = useState<{
    url: string;
    outcome: string;
    extra: unknown;
    cacheVersion: string;
    at: string;
  } | null>(null);
  // Read inside the retry interval below without needing it in that
  // effect's dependency array (which must stay `[]` — it sets up
  // listeners/intervals once for the component's lifetime).
  const isOnlineRef = useRef(isOnline);
  const pendingCountRef = useRef(pendingCount);
  useEffect(() => {
    isOnlineRef.current = isOnline;
    pendingCountRef.current = pendingCount;
  }, [isOnline, pendingCount]);

  // Forces every same-origin link click to use a real hard (browser-level)
  // navigation instead of next/link's client-side soft transition,
  // whenever the app is offline.
  //
  // Why: a next/link soft navigation fetches its destination's RSC payload
  // with a plain fetch() that this app's service worker never intercepts
  // (see sw.js's fetch handler — it only handles request.mode ===
  // "navigate", which an RSC fetch never is). Next.js is documented to
  // fall back to a real hard navigation automatically when that fetch
  // fails, and a from-scratch reproduction (real Next.js 16.3.4 build,
  // the real unmodified sw.js, real Chromium) confirmed that fallback
  // does reach the service worker correctly. But a real-device report
  // disproved relying on it: the offline banner's own WARM_CACHE_RESULT
  // diagnostic confirmed /queries/new WAS fully cached (24/24 pages
  // ready) at the exact moment the user hit a native "This page couldn't
  // load" browser error clicking a next/link "+ New Query" button while
  // offline — meaning the framework's internal fallback did not reliably
  // reach this app's own service worker on that real device/PWA context,
  // for reasons this sandbox cannot further isolate (no way to attach a
  // real-device debugger here). Rather than keep depending on an
  // unverified framework internal, this intercepts the click ourselves
  // and always performs the hard navigation directly — the one path
  // already proven, with real evidence, to reach networkFirst() and
  // correctly serve the cached page.
  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      if (isOnlineRef.current) return;
      if (event.defaultPrevented) return;
      if (event.button !== 0) return; // left-click only
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // respect open-in-new-tab etc.

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // A same-page hash/anchor link (or a click that doesn't actually
      // change the URL) keeps its normal default behavior.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      event.preventDefault();
      event.stopPropagation();
      window.location.href = url.href;
    }

    // Capture phase, on `document` — runs before the click reaches the
    // anchor itself, so it pre-empts next/link's own bubble-phase click
    // handler (the one that would otherwise start the soft navigation).
    document.addEventListener("click", handleDocumentClick, true);
    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, []);

  // Polls sw.js's persisted NAV_DEBUG_URL record directly from Cache
  // Storage (the same store the service worker itself writes to — no
  // message-passing needed, since Cache Storage is shared between a page
  // and the service worker controlling it). Polls unconditionally on an
  // interval, rather than only once, specifically because a hard
  // navigation (including the one this file's own click interceptor now
  // forces) unmounts and remounts this whole component — an effect that
  // only ran once on mount would miss whatever the service worker records
  // for that very navigation.
  useEffect(() => {
    if (typeof window === "undefined" || !("caches" in window)) return;
    let cancelled = false;

    async function readNavDebug() {
      try {
        const res = await caches.match("/__debug/last-nav");
        if (!res) return;
        const data = await res.json();
        if (!cancelled) setLastNavDebug(data);
      } catch {
        // Best-effort diagnostic only.
      }
    }

    readNavDebug();
    const interval = setInterval(readNavDebug, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const refreshPendingCount = useCallback(async () => {
    const items = await listQueuedWrites();
    setPendingCount(items.length);
  }, []);

  const runFlush = useCallback(async () => {
    const { synced, conflicts } = await flushQueue();
    await refreshPendingCount();
    if (synced.length > 0 || conflicts.length > 0) {
      const parts = [
        synced.length > 0 ? `${synced.length} offline change${synced.length > 1 ? "s" : ""} synced` : null,
        conflicts.length > 0 ? `${conflicts.length} need${conflicts.length > 1 ? "" : "s"} review` : null,
      ].filter(Boolean);
      setSyncMessage(parts.join(" — "));
    }
    if (conflicts.length > 0) setSyncedConflicts((prev) => [...prev, ...conflicts]);
  }, [refreshPendingCount]);

  useEffect(() => {
    let cancelled = false;

    // Re-verifies actual connectivity (not just the interface flag) and
    // reconciles `isOnline` state — corrects a stale/wrong initial guess,
    // and lets the app recover from a false "Offline" without waiting on
    // a browser `online` event that may never fire.
    async function reconcile() {
      const { ok: reallyOnline, reason } = await verifyRealConnectivity();
      if (cancelled) return;
      setOfflineReason(reallyOnline ? null : (reason ?? null));
      setIsOnline((prev) => {
        if (reallyOnline && !prev) runFlush();
        return reallyOnline;
      });
      if (!reallyOnline) await refreshPendingCount();
    }

    // Deferred to a microtask (rather than called directly in the effect
    // body) so the state updates this async function eventually makes
    // happen strictly after this render has committed.
    queueMicrotask(reconcile);

    function handleOnline() {
      reconcile();
    }
    function handleOffline() {
      // Don't trust the event alone — verify before showing "Offline",
      // since this event fires on plenty of false negatives.
      reconcile();
    }
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") reconcile();
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Two reasons to keep polling on a timer, covering requirement #6
    // (a failed sync must retry automatically, never just sit stuck):
    // - While marked offline: re-check connectivity so the banner clears
    //   itself the moment it genuinely returns.
    // - While online but items are still pending (e.g. the last flush
    //   hit a transient server error rather than a connectivity one —
    //   `flushQueue` leaves failed items queued untouched): retry the
    //   flush again without waiting for another online/offline edge.
    const interval = setInterval(() => {
      if (!isOnlineRef.current) {
        reconcile();
      } else if (pendingCountRef.current > 0) {
        runFlush();
      }
    }, RECHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Closes a real, reported gap: the offline-queue create forms
  // (Queries, Tasks) only ever worked while offline if their page had
  // ALREADY been successfully visited at least once — each is a live
  // Server Component fetch (a party/source dropdown list), not a static
  // file, so with nothing yet cached, networkFirst()'s only fallback was
  // the generic offline.html page. Someone who opened the app and went
  // straight offline before ever visiting /queries/new, say, could never
  // even reach the form — no matter how solid the offline-queue code on
  // that form itself is. Tells the service worker to proactively fetch
  // + cache those specific pages itself (see WARM_CACHE in sw.js)
  // whenever a real connectivity check has confirmed we're online — so
  // by the time anyone actually needs one offline, it's very likely
  // already sitting in cache with reasonably current dropdown data,
  // regardless of what they've personally clicked on today.
  useEffect(() => {
    if (!isOnline) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;
    let retriesUsed = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const cachedSoFar = new Set<string>();

    function sendWarmCache(registration: ServiceWorkerRegistration, urls: string[]) {
      registration.active?.postMessage({ type: "WARM_CACHE", urls });
    }

    // Listens for the service worker's WARM_CACHE_RESULT ack (see sw.js)
    // and retries only the URLs it reports as still missing, up to
    // WARM_CACHE_MAX_RETRIES times, staggered WARM_CACHE_RETRY_DELAY_MS
    // apart — closes the fire-and-forget gap described above without
    // waiting for a whole new offline->online transition. Also mirrors
    // the running result into warmCacheStatus (see its own comment above)
    // so a real device that still can't reach an offline-capable page
    // after this whole pass produces hard evidence, not another guess.
    function handleMessage(event: MessageEvent) {
      if (cancelled) return;
      if (!event.data || event.data.type !== "WARM_CACHE_RESULT") return;
      const cached: string[] = Array.isArray(event.data.cached) ? event.data.cached : [];
      const failed: string[] = Array.isArray(event.data.failed) ? event.data.failed : [];
      cached.forEach((url) => cachedSoFar.add(url));
      setWarmCacheStatus({ cachedCount: cachedSoFar.size, total: WARM_CACHE_URLS.length, failed });
      if (failed.length === 0) return;
      if (retriesUsed >= WARM_CACHE_MAX_RETRIES) return;
      retriesUsed += 1;
      retryTimer = setTimeout(() => {
        if (cancelled) return;
        navigator.serviceWorker.ready.then((registration) => {
          if (cancelled) return;
          sendWarmCache(registration, failed);
        });
      }, WARM_CACHE_RETRY_DELAY_MS);
    }

    navigator.serviceWorker.addEventListener("message", handleMessage);
    navigator.serviceWorker.ready.then((registration) => {
      if (cancelled) return;
      sendWarmCache(registration, WARM_CACHE_URLS);
    });

    // Phase 9: a real structured cache for the dropdown master data
    // itself (Parties/Items/Warehouses), not just whole cached HTML page
    // snapshots — shared across every consumer form instead of frozen
    // per-page at whatever moment that specific page last got warmed.
    // Same online-transition trigger as WARM_CACHE above, for the same
    // reason: reconnect is the moment a refresh is actually worth doing.
    refreshMasterDataCache(createClient());

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("message", handleMessage);
      clearTimeout(retryTimer);
    };
    // Re-warms on every online transition (a fresh mount, or recovering
    // from a real offline period) rather than just once ever — cheap
    // (a handful of small page fetches) and keeps the cached dropdown
    // data from silently going stale over a long session.
  }, [isOnline]);

  const enqueue = useCallback(
    async (entry: QueuedWriteInput) => {
      await enqueueWrite(entry);
      await refreshPendingCount();
    },
    [refreshPendingCount]
  );

  const resolveSyncedConflict = useCallback(async (conflict: SyncedConflict, field: string, choice: "mine" | "theirs") => {
    const c = conflict.conflicts.find((x) => x.field === field);
    if (!c) return;
    if (choice === "mine") {
      const supabase = createClient();
      await smartMergeUpdate(supabase, conflict.table, conflict.rowId, { [field]: c.server_value }, { [field]: c.my_value });
    }
    // "theirs" needs no write — the server's value is already what's saved.
    setSyncedConflicts((prev) =>
      prev
        .map((sc) => (sc.id === conflict.id ? { ...sc, conflicts: sc.conflicts.filter((x) => x.field !== field) } : sc))
        .filter((sc) => sc.conflicts.length > 0)
    );
  }, []);

  return (
    <OfflineQueueContext.Provider value={{ isOnline, pendingCount, enqueue }}>
      {children}
      <OfflineStatusBanner
        isOnline={isOnline}
        pendingCount={pendingCount}
        offlineReason={offlineReason}
        buildVersion={buildVersion}
        warmCacheStatus={warmCacheStatus}
        lastNavDebug={lastNavDebug}
      />
      {syncMessage && <SyncToast message={syncMessage} onDismiss={() => setSyncMessage(null)} />}
      {syncedConflicts.map((conflict) => (
        <SyncConflictBanner
          key={conflict.id}
          conflict={conflict}
          onResolve={resolveSyncedConflict}
          onDismiss={() => setSyncedConflicts((prev) => prev.filter((c) => c.id !== conflict.id))}
        />
      ))}
    </OfflineQueueContext.Provider>
  );
}

function OfflineStatusBanner({
  isOnline,
  pendingCount,
  offlineReason,
  buildVersion,
  warmCacheStatus,
  lastNavDebug,
}: {
  isOnline: boolean;
  pendingCount: number;
  offlineReason: string | null;
  buildVersion?: string;
  warmCacheStatus: { cachedCount: number; total: number; failed: string[] } | null;
  lastNavDebug: { url: string; outcome: string; extra: unknown; cacheVersion: string; at: string } | null;
}) {
  if (isOnline && pendingCount === 0) return null;
  return (
    <div className="fixed left-1/2 top-3 z-50 -translate-x-1/2 max-w-[90vw] rounded-2xl border border-line-strong bg-surface px-3 py-1.5 text-xs shadow-md">
      {!isOnline ? (
        <span className="text-warn">
          ⚠ Offline{pendingCount > 0 ? ` — ${pendingCount} change${pendingCount > 1 ? "s" : ""} pending sync` : ""}
          {/* Shown so a report of "this is wrong, I'm actually online" comes
              with the exact reason attached (a screenshot) instead of just
              a boolean — turns the next mystery case into something
              diagnosable on the first report instead of several rounds of
              guessing. */}
          {offlineReason && <span className="ml-1 text-ink-faint">({offlineReason})</span>}
          {/* Answers "is this device even running the latest deployed
              code?" directly from a screenshot — see buildVersion's own
              comment above. */}
          {buildVersion && <span className="ml-1 text-ink-faint">[{buildVersion}]</span>}
        </span>
      ) : (
        <span className="text-ink-soft">Syncing {pendingCount} pending change{pendingCount > 1 ? "s" : ""}…</span>
      )}
      {/* Surfaces the service worker's own WARM_CACHE_RESULT ack (see
          OfflineQueueProvider's WARM_CACHE effect and sw.js) — added so a
          real device that still can't reach an offline-capable page after
          a full warm pass produces hard evidence (exactly which URLs never
          made it into the cache, visible right on the Offline banner a
          screenshot already captures) instead of another round of
          guessing at the cause. */}
      {warmCacheStatus && (
        <div className="mt-0.5 text-[10px] text-ink-faint">
          Offline pages ready: {warmCacheStatus.cachedCount}/{warmCacheStatus.total}
          {warmCacheStatus.failed.length > 0 && (
            <span className="text-warn"> — not ready: {warmCacheStatus.failed.join(", ")}</span>
          )}
        </div>
      )}
      {/* Mirrors sw.js's own persisted NAV_DEBUG_URL record — see its own
          comment and this component's lastNavDebug state. Shows exactly
          what the service worker's fetch handler last did with a real
          navigation: whether the event fired at all, and whether it
          served the network, a cache hit, the offline.html fallback, or
          had nothing to fall back to. */}
      {lastNavDebug && (
        <div className="mt-0.5 break-all text-[10px] text-ink-faint">
          Last nav [{lastNavDebug.cacheVersion}]: {lastNavDebug.url} → {lastNavDebug.outcome}
        </div>
      )}
    </div>
  );
}

function SyncToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-full max-w-sm items-center justify-between gap-3 rounded-lg border border-line-strong bg-surface px-4 py-3 text-sm shadow-lg">
      <span className="text-ink">{message}</span>
      <button type="button" onClick={onDismiss} className="shrink-0 text-xs text-ink-faint underline underline-offset-2">
        Dismiss
      </button>
    </div>
  );
}

const CONFLICT_FIELD_LABEL: Record<string, string> = {
  credit_limit: "Credit Limit",
  credit_days: "Credit Days",
  legal_name: "Company Name",
  name: "Name",
  ntn: "NTN",
  strn: "STRN",
  address: "Address",
  province: "Province",
  phone: "Phone",
  email: "Email",
  default_sales_tax_pct: "Default Sales Tax (GST) %",
};

function SyncConflictBanner({
  conflict,
  onResolve,
  onDismiss,
}: {
  conflict: SyncedConflict;
  onResolve: (conflict: SyncedConflict, field: string, choice: "mine" | "theirs") => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md space-y-2 rounded-lg border border-warn bg-warn-soft p-3 text-xs shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="mb-1 inline-block rounded-full bg-warn px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Conflict
          </span>
          <p className="font-medium text-warn">
            Another user has updated &quot;{conflict.label}&quot;. Please review the latest version before applying
            your changes.
          </p>
        </div>
        <button type="button" onClick={onDismiss} className="shrink-0 text-ink-faint underline underline-offset-2">
          Later
        </button>
      </div>
      {conflict.conflicts.map((c: SmartMergeConflict) => (
        <div key={c.field} className="space-y-1 rounded border border-line-strong bg-bg p-2">
          <p className="text-ink-soft">
            <span className="font-medium">{CONFLICT_FIELD_LABEL[c.field] ?? c.field}</span> — Server:{" "}
            <span className="font-mono">{String(c.server_value ?? "—")}</span>, your (offline) value:{" "}
            <span className="font-mono">{String(c.my_value ?? "—")}</span>
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => onResolve(conflict, c.field, "mine")} className="flex-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white">
              Keep mine
            </button>
            <button type="button" onClick={() => onResolve(conflict, c.field, "theirs")} className="flex-1 rounded-md border border-line-strong bg-bg px-2 py-1 text-[11px]">
              Keep server&apos;s
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
