// Phase 18 Part A.4/5 — local-first optimistic UI + offline write queue.
// Extended in Phase 22 to also queue offline-safe record CREATES, not
// just edits to an existing row. Hardened in the Master Offline-First
// Roadmap's Phase 0 (see /root/.claude/plans — the plan the user
// approved) with formal per-item sync state, retryable-vs-permanent
// error classification with bounded backoff, cross-tab sync
// coordination, and a temp-ID -> server-ID mapping so a later phase's
// dependent offline creates (e.g. a new Party, then a new Query for
// that same Party, both made while offline) can be represented safely.
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
import { smartMergeUpdate, type SmartMergeConflict, type SmartMergeError } from "@/lib/smartMerge";

/**
 * Lifecycle of one queued write. "syncing"/"conflict"/"synced" are never
 * actually persisted back to the store — a synced item is deleted
 * outright, and a conflict is reported to the caller then also deleted
 * (its non-conflicting fields already applied) — but they're listed here
 * because callers (the pending-sync UI) reason about the same states.
 * Only the states a write can actually be found SITTING in between
 * flush attempts are ever written to IndexedDB.
 */
export type SyncItemStatus = "pending" | "syncing" | "failed-retryable" | "failed-permanent" | "blocked";

/** One entry in a write's `dependsOn` list: this operation can't safely
 * run until `queuedId` (another queued write, usually a "create") has
 * itself synced and been assigned a real server id — at which point that
 * id is substituted into this write's `field` before its own RPC call.
 * Nothing in the app populates this yet (Query/Task creates today only
 * ever reference an *existing*, already-synced Party) — this is the
 * Phase 0 infrastructure a later roadmap phase (offline-create a Party,
 * then offline-create a Query for that same Party) will actually use. */
export type DependencyRef = { queuedId: string; field: string };

type SyncMeta = {
  status: SyncItemStatus;
  retryCount: number;
  lastError: string | null;
  /** ISO timestamp; a retryable failure isn't attempted again before this. */
  nextRetryAt: string | null;
  dependsOn: DependencyRef[];
};

export type QueuedEdit = SyncMeta & {
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
export type QueuedCreate = SyncMeta & {
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

/** What a caller actually provides to `enqueueWrite` — everything Phase 0's
 * sync-state bookkeeping owns is filled in automatically; `dependsOn` is
 * the one exception a future dependent-create caller can set explicitly. */
export type QueuedWriteInput = DistributiveOmit<
  QueuedWrite,
  "id" | "createdAt" | "status" | "retryCount" | "lastError" | "nextRetryAt" | "dependsOn"
> & { dependsOn?: DependencyRef[] };

export type SyncedConflict = QueuedEdit & { conflicts: SmartMergeConflict[] };

type SupabaseBrowserClient = ReturnType<typeof createClient>;
/** Same shape as SmartMergeError — a Postgres/PostgREST error's `code` is
 * what the retry classifier below actually keys on. */
type RpcError = { message: string; code?: string };

/**
 * One idempotent-create RPC call per queued table. Adding a new offline-
 * safe create for another document type means adding its RPC name to
 * the `table` union above and one entry here — flushQueue() itself never
 * needs to change.
 */
const CREATE_RPC: {
  [T in QueuedCreate["table"]]: (supabase: SupabaseBrowserClient, write: QueuedCreate) => PromiseLike<{ error: RpcError | null }>;
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
// v1 -> v2: added the idMappings store (temp-id -> server-id, for
// dependent offline creates). Existing `writes` entries from a v1
// database are read fine as-is — every new SyncMeta field is optional
// at the READING sites below (`??` fallbacks), so an old stored item
// without them just behaves as "pending, never retried yet".
const DB_VERSION = 2;
const STORE = "writes";
const ID_MAP_STORE = "idMappings";

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
      if (!db.objectStoreNames.contains(ID_MAP_STORE)) {
        db.createObjectStore(ID_MAP_STORE, { keyPath: "queuedId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open offline queue database"));
  });
}

async function withStoreNamed<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Offline queue operation failed"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return withStoreNamed<T>(STORE, mode, fn);
}

const DEFAULT_SYNC_META: SyncMeta = { status: "pending", retryCount: 0, lastError: null, nextRetryAt: null, dependsOn: [] };

/** Finds an existing PENDING (not yet synced) queued edit for the same
 * row, if any. Used so a second offline edit to the same record merges
 * into the first instead of creating a confusing second queue entry with
 * a stale `base` — see enqueueWrite's own comment. */
export async function findPendingEdit(table: QueuedEdit["table"], rowId: string): Promise<QueuedEdit | null> {
  const all = await listQueuedWrites();
  const match = all.find((w): w is QueuedEdit => w.kind === "edit" && w.table === table && w.rowId === rowId);
  return match ?? null;
}

/**
 * Persist a write for later replay — used when the browser is offline (or
 * the save just failed on a network error). Never overwrites/loses a
 * queued item outright: each new *create* gets its own id and stays
 * until confirmed synced.
 *
 * An *edit* to a row that already has a pending queued edit is the one
 * exception — it MERGES into the existing entry rather than creating a
 * second one: `base` stays exactly what it was (that's still the true
 * last-confirmed-synced state), and the new `changes` are layered on top
 * of the old ones (last write for a given field wins). Without this, two
 * offline edits to the same record before either syncs would queue as
 * two separate Smart Merge calls with the SECOND one's `base` wrongly
 * describing the FIRST one's un-synced values as "already saved" — and
 * the pending-sync UI would confusingly show two entries for one record.
 */
export async function enqueueWrite(entry: QueuedWriteInput): Promise<QueuedWrite> {
  if (entry.kind === "edit") {
    const existing = await findPendingEdit(entry.table, entry.rowId);
    if (existing) {
      const merged: QueuedEdit = {
        ...existing,
        changes: { ...existing.changes, ...entry.changes },
        // A merge is still a fresh "please retry from scratch" — clear
        // any prior failure state rather than leaving a stale backoff
        // timer from the earlier attempt.
        status: "pending",
        nextRetryAt: null,
      };
      await withStore("readwrite", (store) => store.put(merged));
      return merged;
    }
  }
  const write = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...DEFAULT_SYNC_META,
    dependsOn: entry.dependsOn ?? [],
  } as QueuedWrite;
  await withStore("readwrite", (store) => store.put(write));
  return write;
}

export async function listQueuedWrites(): Promise<QueuedWrite[]> {
  try {
    const raw = await withStore<QueuedWrite[]>("readonly", (store) => store.getAll());
    // Defends against a v1-era stored item (before this file's Phase 0
    // hardening) that has none of the SyncMeta fields at all.
    return raw.map((w) => ({ ...DEFAULT_SYNC_META, ...w }));
  } catch {
    return [];
  }
}

export async function removeQueuedWrite(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}

async function updateQueuedWrite(write: QueuedWrite, patch: Partial<SyncMeta>): Promise<void> {
  await withStore("readwrite", (store) => store.put({ ...write, ...patch }));
}

async function recordIdMapping(queuedId: string, serverId: string, table: string): Promise<void> {
  await withStoreNamed(ID_MAP_STORE, "readwrite", (store) =>
    store.put({ queuedId, serverId, table, mappedAt: new Date().toISOString() })
  );
}

async function getIdMapping(queuedId: string): Promise<{ serverId: string; table: string } | undefined> {
  return withStoreNamed(ID_MAP_STORE, "readonly", (store) => store.get(queuedId));
}

// ---- Retry classification & backoff ----

// Genuinely transient Postgres/connection-level error codes — the
// request DID reach a real database, but for a reason that has nothing
// to do with whether the operation itself is valid, and can legitimately
// succeed if simply tried again: a serialization/deadlock loser under
// concurrent load, a dropped connection, a statement timeout, too many
// connections. Every other code (a raised business-rule exception from
// inside an RPC like "Cancelled Sales Order par invoice nahi ban sakti",
// a unique/foreign-key violation, etc.) means the server actually
// evaluated this exact request and rejected it for a real reason —
// retrying the identical payload would fail identically forever.
const RETRYABLE_PG_CODES = new Set(["40001", "40P01", "08000", "08001", "08003", "08004", "08006", "57014", "53300"]);

function classifySyncError(error: RpcError | null | undefined): "retryable" | "permanent" {
  if (!error) return "permanent"; // shouldn't happen, but never spin forever on nothing to classify
  // No `code` at all means this never reached the database as a
  // structured Postgres error in the first place — a network failure,
  // timeout, or the fetch call itself throwing (genuinely offline).
  // Always safe, and necessary, to retry.
  if (!error.code) return "retryable";
  return RETRYABLE_PG_CODES.has(error.code) ? "retryable" : "permanent";
}

const BASE_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000; // 5 minutes — never retry less often than this once backed off
const MAX_BACKOFF_EXPONENT = 10; // 5s * 2^10 already exceeds the 5-minute cap, so this alone bounds the delay

function computeNextRetryAt(retryCount: number): string {
  const delay = Math.min(BASE_RETRY_DELAY_MS * 2 ** Math.min(retryCount, MAX_BACKOFF_EXPONENT), MAX_RETRY_DELAY_MS);
  return new Date(Date.now() + delay).toISOString();
}

async function handleSyncFailure(write: QueuedWrite, error: RpcError): Promise<void> {
  const kind = classifySyncError(error);
  const retryCount = (write.retryCount ?? 0) + 1;
  await updateQueuedWrite(write, {
    status: kind === "retryable" ? "failed-retryable" : "failed-permanent",
    retryCount,
    lastError: error.message,
    nextRetryAt: kind === "retryable" ? computeNextRetryAt(retryCount) : null,
  });
}

// ---- Cross-tab sync coordination ----

/**
 * Wraps a flush attempt so at most one tab/document actually processes
 * the queue at a time — two tabs both reconnecting at once (or a
 * flapping connection re-triggering the interval in each) would
 * otherwise both call flushQueue() concurrently. Server-side idempotency
 * (the idempotent create RPCs, and Smart Merge's own value-comparison,
 * which is a no-op if re-applied) is what actually PREVENTS corruption
 * either way — this lock exists purely to avoid redundant network calls
 * and doubled "N changes synced" toasts, not as the safety mechanism
 * itself. Falls back to just running directly on a browser without the
 * Web Locks API.
 */
async function runWithSyncLock<T>(fn: () => Promise<T>): Promise<T | null> {
  if (typeof navigator === "undefined" || !("locks" in navigator)) {
    return fn();
  }
  return navigator.locks.request("hitech-offline-sync-flush", { ifAvailable: true }, async (lock) => {
    if (!lock) return null; // another tab is already flushing right now — skip this round entirely
    return fn();
  });
}

/**
 * Replays every due queued write.
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
 *   that didn't exist yet. Its server-assigned id is recorded in the
 *   temp-id -> server-id map so any later queued write that `dependsOn`
 *   it can resolve the real id.
 *
 * A write is only ever removed from the queue after the server has
 * actually confirmed the complete operation — a network failure (still
 * offline, or a transient error) leaves it queued untouched, retried
 * with bounded backoff; a permanent business/validation failure is left
 * queued too (never silently discarded) but stops being retried blindly,
 * surfaced instead via its `lastError` for the user to fix or remove.
 *
 * Dependency resolution runs in multiple passes within THIS SAME flush
 * call, not strictly in queue order — `listQueuedWrites()` reads back via
 * IndexedDB's `getAll()`, which iterates in *primary-key* order (each
 * item's `id`, a random UUID), NOT insertion order. So a dependent write
 * can easily come back BEFORE the very dependency it's waiting on. A
 * single top-to-bottom pass would wrongly mark that dependent "blocked"
 * even though its dependency is sitting later in the exact same batch
 * about to succeed. Instead: attempt everything that's due; whatever's
 * blocked purely because its dependency hasn't been attempted YET (this
 * pass) is retried in a follow-up pass; repeat until a full pass makes no
 * further progress. Only THEN is anything actually marked "blocked" —
 * confirmed via a real test: a create and a dependent edit queued with the
 * edit landing first in getAll() order both sync in one flushQueue() call.
 */
export async function flushQueue(): Promise<{ synced: QueuedWrite[]; conflicts: SyncedConflict[]; failed: QueuedWrite[] }> {
  const outcome = await runWithSyncLock(async () => {
    const queued = await listQueuedWrites();
    const synced: QueuedWrite[] = [];
    const conflicts: SyncedConflict[] = [];
    const failed: QueuedWrite[] = [];
    if (queued.length === 0) return { synced, conflicts, failed };

    const supabase = createClient();
    const stillQueuedIds = new Set(queued.map((w) => w.id));

    // Attempts one write. Returns "done" once it's fully resolved this
    // round (synced, conflicted, or failed) — including a failed attempt,
    // which is a resolved outcome for THIS round even though the write
    // stays queued for a later retry. Returns "blocked" only when a
    // dependency hasn't been attempted (or resolved) yet, meaning it's
    // worth retrying again in a later pass of this same flush.
    async function attempt(write: QueuedWrite): Promise<"done" | "blocked"> {
      const fieldOverrides: Record<string, string> = {};
      for (const dep of write.dependsOn) {
        if (stillQueuedIds.has(dep.queuedId)) return "blocked";
        const mapped = await getIdMapping(dep.queuedId);
        if (!mapped) return "blocked"; // dependency was removed/failed without ever syncing
        fieldOverrides[dep.field] = mapped.serverId;
      }

      await updateQueuedWrite(write, { status: "syncing" });

      // supabase-js's own `.rpc()` never actually throws for a network
      // failure — PostgrestBuilder catches it internally and resolves
      // with `{ error }` instead (confirmed directly from
      // @supabase/postgrest-js's source; this app never calls
      // `.throwOnError()`) — but this try/catch is still the right
      // backstop: a bug in a future fetch wrapper, an IndexedDB hiccup in
      // recordIdMapping/removeQueuedWrite, or anything else this code
      // hasn't anticipated must never propagate out of flushQueue() and
      // silently take down its caller's polling loop (OfflineQueueProvider
      // never wraps flushQueue() in a try/catch of its own) — the same
      // crash-during-sync resilience this queue promises at the network
      // layer applies here too.
      try {
        if (write.kind === "create") {
          const resolved: QueuedCreate = { ...write, payload: { ...write.payload, ...fieldOverrides } };
          const { error } = await CREATE_RPC[write.table](supabase, resolved);
          if (error) {
            await handleSyncFailure(write, error);
            failed.push(write);
            return "done";
          }
          await recordIdMapping(write.id, write.recordId, write.table);
          await removeQueuedWrite(write.id);
          stillQueuedIds.delete(write.id);
          synced.push(write);
          return "done";
        }

        const changes = { ...write.changes, ...fieldOverrides };
        const { result, error } = await smartMergeUpdate(supabase, write.table, write.rowId, write.base, changes);
        if (error) {
          await handleSyncFailure(write, error as SmartMergeError);
          failed.push(write);
          return "done";
        }
        await removeQueuedWrite(write.id);
        stillQueuedIds.delete(write.id);
        if (result && result.conflicts.length > 0) {
          conflicts.push({ ...write, conflicts: result.conflicts });
        } else {
          synced.push(write);
        }
        return "done";
      } catch (e) {
        // Classified as retryable (no PG code): a genuinely permanent bug
        // would just keep failing identically and still surface via
        // `lastError` for the user either way, never silently swallowed.
        const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        await handleSyncFailure(write, { message });
        failed.push(write);
        return "done";
      }
    }

    // First pass, in `queued`'s (arbitrary) order: skip anything not due
    // yet — that's a backoff wait, not a dependency block, and re-checking
    // it again a few milliseconds later within this same flush would never
    // change the outcome — everything else gets one real attempt.
    let toRetry: QueuedWrite[] = [];
    for (const write of queued) {
      if (write.nextRetryAt && new Date(write.nextRetryAt).getTime() > Date.now()) continue;
      if ((await attempt(write)) === "blocked") toRetry.push(write);
    }

    // Further passes: only for writes still waiting on a dependency that
    // may since have been attempted (and resolved) in a prior pass.
    // Bounded by the dependency chain's depth — each pass either resolves
    // at least one more write or the loop stops.
    let progressed = toRetry.length > 0;
    while (progressed && toRetry.length > 0) {
      progressed = false;
      const stillBlocked: QueuedWrite[] = [];
      for (const write of toRetry) {
        if ((await attempt(write)) === "blocked") {
          stillBlocked.push(write);
        } else {
          progressed = true;
        }
      }
      toRetry = stillBlocked;
    }

    // Whatever's left after passes stop making progress has a genuinely
    // unresolved dependency (removed/failed without ever syncing) — never
    // silently dropped, surfaced as "blocked" for the pending-sync UI.
    for (const write of toRetry) {
      await updateQueuedWrite(write, { status: "blocked" });
    }

    return { synced, conflicts, failed };
  });

  return outcome ?? { synced: [], conflicts: [], failed: [] };
}
