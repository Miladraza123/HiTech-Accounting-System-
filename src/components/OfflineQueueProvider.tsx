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
        synced.length > 0 ? `${synced.length} offline change${synced.length > 1 ? "s" : ""} sync ho gaye` : null,
        conflicts.length > 0 ? `${conflicts.length} ko review chahiye` : null,
      ].filter(Boolean);
      setSyncMessage(parts.join(" — "));
    }
    if (conflicts.length > 0) setSyncedConflicts((prev) => [...prev, ...conflicts]);
  }, [refreshPendingCount]);

  useEffect(() => {
    // Deferred to a microtask (rather than called directly in the effect
    // body) so the state updates these two async functions eventually
    // make happen strictly after this render has committed.
    queueMicrotask(() => {
      if (navigator.onLine) runFlush();
      else refreshPendingCount();
    });

    function handleOnline() {
      setIsOnline(true);
      runFlush();
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
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
        <span className="text-ink-soft">{pendingCount} pending change{pendingCount > 1 ? "s" : ""} sync ho rahe hain…</span>
      )}
    </div>
  );
}

function SyncToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-full max-w-sm items-center justify-between gap-3 rounded-lg border border-line-strong bg-surface px-4 py-3 text-sm shadow-lg">
      <span className="text-ink">{message}</span>
      <button type="button" onClick={onDismiss} className="shrink-0 text-xs text-ink-faint underline underline-offset-2">
        Band karen
      </button>
    </div>
  );
}

const CONFLICT_FIELD_LABEL: Record<string, string> = {
  credit_limit: "Credit Limit",
  credit_days: "Credit Days",
  legal_name: "Company ka naam",
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
          &quot;{conflict.label}&quot; offline sync hote waqt kisi aur ne yeh field(s) badal di thi:
        </p>
        <button type="button" onClick={onDismiss} className="shrink-0 text-ink-faint underline underline-offset-2">
          Baad mein
        </button>
      </div>
      {conflict.conflicts.map((c: SmartMergeConflict) => (
        <div key={c.field} className="space-y-1 rounded border border-line-strong bg-bg p-2">
          <p className="text-ink-soft">
            <span className="font-medium">{CONFLICT_FIELD_LABEL[c.field] ?? c.field}</span> — Server:{" "}
            <span className="font-mono">{String(c.server_value ?? "—")}</span>, Aap ka (offline) value:{" "}
            <span className="font-mono">{String(c.my_value ?? "—")}</span>
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => onResolve(conflict, c.field, "mine")} className="flex-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white">
              Mera value rakhen
            </button>
            <button type="button" onClick={() => onResolve(conflict, c.field, "theirs")} className="flex-1 rounded-md border border-line-strong bg-bg px-2 py-1 text-[11px]">
              Server ka value rakhen
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
