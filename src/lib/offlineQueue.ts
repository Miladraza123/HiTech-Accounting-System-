// Phase 18 Part A.4/5 — local-first optimistic UI + offline write queue.
// Extended in Phase 22 to also queue offline-safe record CREATES, not
// just edits to an existing row.
//
// Two kinds of queued write:
//
// - "edit" — this app's editable documents (queries -> quotations ->
//   sales orders -> jobs -> invoices -> ...) are append-only workflow
//   documents created/transitioned through dedicated RPCs, not
//   free-form "edit this record" forms — see the scope note in the
//   Smart Merge migration. The only two genuine free-edit-anytime forms
//   in the app (Company Profile, Party Credit Terms) are also the only
//   two wired into Smart Merge, so they're exactly where a queued
//   offline edit can be replayed safely: this queue routes every replay
//   through the SAME `fn_smart_merge_update` conflict-aware RPC a normal
//   online save uses (never a plain overwrite).
//
// - "create" — a brand new record. The browser generates the row's UUID
//   itself (crypto.randomUUID()) *before* going online, so two different
//   offline users can never collide on the same id — Postgres's own
//   primary key guarantees that. Replayed through a per-table idempotent
//   RPC (e.g. `fn_create_query_idempotent`, `fn_create_task_idempotent`)
//   that's safe to call more than once with the same id: if the row
//   already exists (a retried sync after a dropped connection, say), it
//   just returns the existing id instead of creating a duplicate. Query
//   (Phase 22) and Task (Phase 25) are wired up so far — see each RPC's
//   own comment for why the other document types (multi-row, real-time
//   stock/credit checks) aren't yet.
//
// A tiny, dependency-free IndexedDB wrapper (no external idb/dexie lib)
// persists queued writes across reloads/navigations, since an in-memory
// queue would be lost the moment the offline tab is closed.

import { createClient } from "@/lib/supabase/client";
import { smartMergeUpdate, type SmartMergeConflict } from "@/lib/smartMerge";

export type QueuedEdit = {
  kind: "edit";
  id: string;
  table: "company" | "parties";
  rowId: string;
  /** Human-readable label shown in the pending-sync UI, e.g. "Company Profile". */
  label: string;
  base: Record<string, unknown>;
  changes: Record<string, unknown>;
  createdAt: string;
};

/** A brand-new record queued while offline. `recordId` is the client-generated UUID that becomes the row's real, permanent id once synced. */
export type QueuedCreate = {
  kind: "create";
  id: string;
  table: "queries" | "tasks";
  recordId: string;
  /** Human-readable label shown in the pending-sync UI, e.g. "Query". */
  label: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type QueuedWrite = QueuedEdit | QueuedCreate;

// Plain `Omit<QueuedWrite, K>` does NOT distribute over the union — since
// `keyof (A | B)` collapses to only the keys A and B have in common,
// `Omit<QueuedWrite, ...>` would silently drop every field unique to
// either branch (rowId/base/changes, recordId/payload). This distributive
// version applies Omit to each union member separately instead.
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type SyncedConflict = QueuedEdit & { conflicts: SmartMergeConflict[] };

type SupabaseBrowserClient = ReturnType<typeof createClient>;

/**
 * One idempotent-create RPC call per queued table. Adding a new offline-
 * safe create for another document type means adding its RPC name to
 * the `table` union above and one entry here — flushQueue() itself never
 * needs to change.
 */
const CREATE_RPC: {
  [T in QueuedCreate["table"]]: (supabase: SupabaseBrowserClient, write: QueuedCreate) => PromiseLike<{ error: { message: string } | null }>;
} = {
  queries: (supabase, write) =>
    // fn_create_query_idempotent's optional params (p_source, p_query_date,
    // p_next_followup_at, p_notes) have no SQL default, so the generated
    // RPC type is non-nullable `string` — the function and columns both
    // accept a literal NULL fine, so these casts are purely for the type
    // checker (same pattern as setPeriodLockAction/createStockTransferAction).
    supabase.rpc("fn_create_query_idempotent", {
      p_id: write.recordId,
      p_party_id: write.payload.party_id as string,
      p_requirement: write.payload.requirement as string,
      p_source: (write.payload.source ?? null) as string,
      p_query_date: (write.payload.query_date ?? null) as string,
      p_next_followup_at: (write.payload.next_followup_at ?? null) as string,
      p_notes: (write.payload.notes ?? null) as string,
    }),
  tasks: (supabase, write) =>
    supabase.rpc("fn_create_task_idempotent", {
      p_id: write.recordId,
      p_title: write.payload.title as string,
      p_assigned_to: write.payload.assigned_to as string,
      p_description: (write.payload.description ?? null) as string,
      p_due_date: (write.payload.due_date ?? null) as string,
      p_priority: (write.payload.priority ?? "Medium") as string,
      p_related_table: (write.payload.related_table ?? null) as string,
      p_related_id: (write.payload.related_id ?? null) as string,
    }),
};

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

/** Persist a write for later replay — used when the browser is offline (or the save just failed on a network error). Never overwrites/loses a queued item: each gets its own id and stays until it's actually confirmed synced. */
export async function enqueueWrite(entry: DistributiveOmit<QueuedWrite, "id" | "createdAt">): Promise<QueuedWrite> {
  const write = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  } as QueuedWrite;
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
 * Replays every queued write, in the order it was queued.
 *
 * - An "edit" goes through the exact same Smart Merge RPC an online save
 *   uses. One that applies cleanly (or partially, per Smart Merge's
 *   field-level rules) is removed from the queue; one that comes back
 *   with unresolved conflicts is ALSO removed from the pending queue
 *   (its non-conflicting fields are already safely applied) but is
 *   returned so the caller can show the user a resolution prompt for
 *   just those fields — the same conflict UI used for an online save.
 *
 * - A "create" goes through that document type's idempotent create RPC.
 *   It only ever gets ONE clean outcome — synced or failed — never a
 *   field-level conflict, since nobody else could have touched a row
 *   that didn't exist yet.
 *
 * A write is only ever removed from the queue after the server has
 * actually confirmed it — a network failure (still offline, or a
 * transient error) leaves it queued untouched, to retry next time.
 */
export async function flushQueue(): Promise<{ synced: QueuedWrite[]; conflicts: SyncedConflict[]; failed: QueuedWrite[] }> {
  const queued = await listQueuedWrites();
  const synced: QueuedWrite[] = [];
  const conflicts: SyncedConflict[] = [];
  const failed: QueuedWrite[] = [];

  if (queued.length === 0) return { synced, conflicts, failed };

  const supabase = createClient();
  for (const write of queued) {
    if (write.kind === "create") {
      const { error } = await CREATE_RPC[write.table](supabase, write);
      if (error) {
        failed.push(write);
        continue;
      }
      await removeQueuedWrite(write.id);
      synced.push(write);
      continue;
    }

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
