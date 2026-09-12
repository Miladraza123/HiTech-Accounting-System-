"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { smartMergeUpdate, type SmartMergeConflict } from "@/lib/smartMerge";
import {
  enqueueWrite,
  flushQueue,
  listQueuedWrites,
  type QueuedWrite,
  type SyncedConflict,
} from "@/lib/offlineQueue";

type OfflineQueueContextValue = {
  isOnline: boolean;
  pendingCount: number;
  enqueue: (entry: Omit<QueuedWrite, "id" | "createdAt">) => Promise<void>;
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
async function verifyRealConnectivity(): Promise<boolean> {
  try {
    const res = await fetch("/api/ping", { method: "GET", cache: "no-store", signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

const RECHECK_INTERVAL_MS = 15000;

export function OfflineQueueProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== "undefined" ? navigator.onLine : true));
  const [pendingCount, setPendingCount] = useState(0);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncedConflicts, setSyncedConflicts] = useState<SyncedConflict[]>([]);

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
      const reallyOnline = await verifyRealConnectivity();
      if (cancelled) return;
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

    // While marked offline, keep re-checking periodically so the banner
    // clears itself the moment real connectivity returns.
    const interval = setInterval(() => {
      setIsOnline((prev) => {
        if (!prev) reconcile();
        return prev;
      });
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

  const enqueue = useCallback(
    async (entry: Omit<QueuedWrite, "id" | "createdAt">) => {
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
      <OfflineStatusBanner isOnline={isOnline} pendingCount={pendingCount} />
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

function OfflineStatusBanner({ isOnline, pendingCount }: { isOnline: boolean; pendingCount: number }) {
  if (isOnline && pendingCount === 0) return null;
  return (
    <div className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full border border-line-strong bg-surface px-3 py-1.5 text-xs shadow-md">
      {!isOnline ? (
        <span className="text-warn">
          ⚠ Offline{pendingCount > 0 ? ` — ${pendingCount} change${pendingCount > 1 ? "s" : ""} pending sync` : ""}
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
      <div className="flex items-center justify-between">
        <p className="font-medium text-warn">
          Someone else changed these field(s) on &quot;{conflict.label}&quot; while it was syncing offline:
        </p>
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
