// Phase 18 Part A.4/5 — local-first optimistic UI + offline write queue.
//
// Scope: this app's editable documents (queries -> quotations -> sales
// orders -> jobs -> invoices -> ...) are append-only workflow documents
// created/transitioned through dedicated RPCs, not free-form "edit this
// record" forms — see the scope note in the Smart Merge migration. The
// only two genuine free-edit-anytime forms in the app (Company Profile,
// Party Credit Terms) are also the only two wired into Smart Merge, so
// they're exactly where a queued offline edit can be replayed safely:
// this queue routes every replay through the SAME `fn_smart_merge_update`
// conflict-aware RPC a normal online save uses (never a plain overwrite),
// per the prompt's own explicit dependency note.
//
// A tiny, dependency-free IndexedDB wrapper (no external idb/dexie lib)
// persists queued writes across reloads/navigations, since an in-memory
// queue would be lost the moment the offline tab is closed.

import { createClient } from "@/lib/supabase/client";
import { smartMergeUpdate, type SmartMergeConflict } from "@/lib/smartMerge";

export type QueuedWrite = {
  id: string;
  table: "company" | "parties";
  rowId: string;
  /** Human-readable label shown in the pending-sync UI, e.g. "Company Profile". */
  label: string;
  base: Record<string, unknown>;
  changes: Record<string, unknown>;
  createdAt: string;
};

export type SyncedConflict = QueuedWrite & { conflicts: SmartMergeConflict[] };

const DB_NAME = "hitech-offline-queue";
const DB_VERSION = 1;
const STORE = "writes";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open offline queue database"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Offline queue operation failed"));
  });
}

/** Persist a write for later replay — used when the browser is offline (or the save just failed on a network error). */
export async function enqueueWrite(entry: Omit<QueuedWrite, "id" | "createdAt">): Promise<QueuedWrite> {
  const write: QueuedWrite = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  await withStore("readwrite", (store) => store.put(write));
  return write;
}

export async function listQueuedWrites(): Promise<QueuedWrite[]> {
  try {
    return await withStore("readonly", (store) => store.getAll());
  } catch {
    return [];
  }
}

export async function removeQueuedWrite(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}

/**
 * Replays every queued write, in the order it was queued, through the
 * exact same Smart Merge RPC an online save uses. A write that applies
 * cleanly (or partially, per Smart Merge's field-level rules) is removed
 * from the queue; a write that comes back with unresolved conflicts is
 * ALSO removed from the pending queue (its non-conflicting fields are
 * already safely applied) but is returned so the caller can show the
 * user a resolution prompt for just those fields — the same conflict UI
 * used for an online save.
 */
export async function flushQueue(): Promise<{ synced: QueuedWrite[]; conflicts: SyncedConflict[]; failed: QueuedWrite[] }> {
  const queued = await listQueuedWrites();
  const synced: QueuedWrite[] = [];
  const conflicts: SyncedConflict[] = [];
  const failed: QueuedWrite[] = [];

  if (queued.length === 0) return { synced, conflicts, failed };

  const supabase = createClient();
  for (const write of queued) {
    const { result, error } = await smartMergeUpdate(supabase, write.table, write.rowId, write.base, write.changes);
    if (error) {
      // Still offline, or a real server error — leave it queued, try again next time.
      failed.push(write);
      continue;
    }
    await removeQueuedWrite(write.id);
    if (result && result.conflicts.length > 0) {
      conflicts.push({ ...write, conflicts: result.conflicts });
    } else {
      synced.push(write);
    }
  }

  return { synced, conflicts, failed };
}
