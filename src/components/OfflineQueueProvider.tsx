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
  // Read inside the retry interval below without needing it in that
  // effect's dependency array (which must stay `[]` — it sets up
  // listeners/intervals once for the component's lifetime).
  const isOnlineRef = useRef(isOnline);
  const pendingCountRef = useRef(pendingCount);
  useEffect(() => {
    isOnlineRef.current = isOnline;
    pendingCountRef.current = pendingCount;
  }, [isOnline, pendingCount]);

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
    navigator.serviceWorker.ready.then((registration) => {
      if (cancelled) return;
      registration.active?.postMessage({
        type: "WARM_CACHE",
        // Phase 1 (Master Offline-First Roadmap): /clients, /items, and
        // /setup/warehouses embed their offline-capable create forms
        // (PartyForm/ItemForm/WarehouseForm) directly on the list page
        // itself rather than a separate /new route — same reachability
        // gap as /queries/new before this mechanism existed (see its own
        // comment above): without this, someone who goes straight offline
        // before ever visiting one of these pages could never reach the
        // form at all.
        //
        // Phase 9: every OTHER static "create" route from Phases 2-8 had
        // the exact same gap and was never added here — a genuine,
        // previously-undiscovered reachability bug found by actually
        // auditing every `useOfflineQueue` consumer's parent page against
        // this list, not assumed. Added below. Two routes are
        // DELIBERATELY still excluded — /quotations/new?query_id= and
        // /sales-orders/new?quotation_id= — since both 404 without a
        // specific parent record id in the URL; a flat URL list can't
        // warm those (documented, not solved, same as every phase since
        // Phase 2 already noted for this exact constraint).
        urls: [
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
          // Phase 11 addendum: embeds NewVehicleForm directly on the list
          // page, same reachability shape as /clients, /items, etc.
          "/setup/vehicles",
        ],
      });
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
}: {
  isOnline: boolean;
  pendingCount: number;
  offlineReason: string | null;
  buildVersion?: string;
}) {
  if (isOnline && pendingCount === 0) return null;
  return (
    <div className="fixed left-1/2 top-3 z-50 -translate-x-1/2 max-w-[90vw] rounded-full border border-line-strong bg-surface px-3 py-1.5 text-xs shadow-md">
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
