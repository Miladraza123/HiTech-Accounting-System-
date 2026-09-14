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
import type { Json } from "@/lib/supabase/database.types";

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
  table: "company" | "parties" | "warehouses";
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
  table:
    | "queries"
    | "tasks"
    | "parties"
    | "items"
    | "warehouses"
    | "quotations"
    | "sales_orders"
    | "purchase_orders"
    | "grns"
    | "delivery_challans"
    | "invoices"
    | "supplier_bills"
    | "payments"
    | "expenses"
    | "bank_accounts"
    | "petty_cash_funds"
    | "sales_returns"
    | "purchase_returns"
    | "stock_transfers"
    | "stock_adjustments"
    | "product_templates"
    | "jobs"
    | "stock_reservations"
    // Issue/Return aren't distinct real tables (both post into the shared
    // job_material_events idempotency log — see the Phase 7 migration) but
    // need two different discriminator values here since each maps to its
    // own RPC in CREATE_RPC below.
    | "job_material_issues"
    | "job_material_returns";
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
  // Phase 1 (Master Offline-First Roadmap) — master data every later
  // document (Sales Order, Purchase Order, ...) references, so it has to
  // be creatable offline first. See
  // supabase/migrations/20260914020000_phase29_01_offline_first_master_data_create.sql.
  parties: (supabase, write) =>
    supabase.rpc("fn_create_party_idempotent", {
      p_id: write.recordId,
      p_party_type: write.payload.party_type as string,
      p_legal_name: write.payload.legal_name as string,
      p_ntn: (write.payload.ntn ?? null) as string,
      p_strn: (write.payload.strn ?? null) as string,
      p_cnic: (write.payload.cnic ?? null) as string,
      p_billing_address: (write.payload.billing_address ?? null) as string,
      p_province: (write.payload.province ?? null) as string,
      p_credit_limit: (write.payload.credit_limit ?? 0) as number,
      p_credit_days: (write.payload.credit_days ?? 0) as number,
    }),
  items: (supabase, write) =>
    supabase.rpc("fn_create_item_idempotent", {
      p_id: write.recordId,
      p_item_code: write.payload.item_code as string,
      p_description: write.payload.description as string,
      p_base_unit: write.payload.base_unit as string,
      p_category: (write.payload.category ?? null) as string,
      p_spec: (write.payload.spec ?? null) as string,
      p_hs_code: (write.payload.hs_code ?? null) as string,
      p_tax_category: (write.payload.tax_category ?? "standard") as string,
      p_is_stocked: (write.payload.is_stocked ?? true) as boolean,
      p_standard_cost: (write.payload.standard_cost ?? 0) as number,
      p_reorder_level: (write.payload.reorder_level ?? null) as number,
    }),
  warehouses: (supabase, write) =>
    supabase.rpc("fn_create_warehouse_idempotent", {
      p_id: write.recordId,
      p_code: write.payload.code as string,
      p_name: write.payload.name as string,
      p_address: (write.payload.address ?? null) as string,
    }),
  // Phase 2 (Master Offline-First Roadmap) — Quotation (Rev-0) and Sales
  // Order creation. Both are pure document creation (no stock posting, no
  // financial commitment) so, like Query/Task, genuinely low-risk offline.
  // NOTE: neither is reachable offline when its parent (the Query for a
  // Quotation, the Quotation for a Sales Order) was ITSELF created offline
  // and hasn't synced yet — /quotations/new and /sales-orders/new are
  // Server Component pages that live-fetch their parent by id and 404 if
  // it isn't found server-side. Same constraint the original Phase 0 audit
  // already noted for Query/Task only ever referencing an *existing*,
  // already-synced Party. See
  // supabase/migrations/20260914030000_phase29_02_offline_first_quotation_so_create.sql.
  quotations: (supabase, write) =>
    supabase.rpc("fn_create_quotation_idempotent", {
      p_id: write.recordId,
      p_query_id: write.payload.query_id as string,
      p_terms: (write.payload.terms ?? null) as string,
      p_validity_date: (write.payload.validity_date ?? null) as string,
      p_delivery_terms: (write.payload.delivery_terms ?? null) as string,
      p_payment_terms: (write.payload.payment_terms ?? null) as string,
      p_lines: write.payload.lines as Json,
    }),
  sales_orders: (supabase, write) =>
    supabase.rpc("fn_create_sales_order_idempotent", {
      p_id: write.recordId,
      p_quotation_id: write.payload.quotation_id as string,
      p_client_po_number: write.payload.client_po_number as string,
      p_po_date: write.payload.po_date as string,
      p_delivery_schedule: (write.payload.delivery_schedule ?? null) as string,
      p_payment_terms: (write.payload.payment_terms ?? null) as string,
      p_business_line: write.payload.business_line as string,
      p_lines: write.payload.lines as Json,
      p_confirm_duplicate: (write.payload.confirm_duplicate ?? false) as boolean,
    }),
  // Phase 3 (Master Offline-First Roadmap) — Purchase Order, GRN (the
  // app's first stock-AND-accounting-posting offline create), and
  // Supplier Bill. Same reachability constraint as Phase 2's Quotation/
  // Sales Order — see
  // supabase/migrations/20260914040000_phase29_03_offline_first_procurement_create.sql.
  purchase_orders: (supabase, write) =>
    supabase.rpc("fn_create_purchase_order_idempotent", {
      p_id: write.recordId,
      p_supplier_id: write.payload.supplier_id as string,
      p_purchase_type: write.payload.purchase_type as string,
      p_linked_sales_order_id: (write.payload.linked_sales_order_id ?? null) as string,
      p_warehouse_id: (write.payload.warehouse_id ?? null) as string,
      p_expected_delivery: (write.payload.expected_delivery ?? null) as string,
      p_lines: write.payload.lines as Json,
    }),
  grns: (supabase, write) =>
    supabase.rpc("fn_create_grn_idempotent", {
      p_id: write.recordId,
      p_supplier_id: write.payload.supplier_id as string,
      p_purchase_order_id: write.payload.purchase_order_id as string,
      p_received_date: write.payload.received_date as string,
      p_warehouse_id: (write.payload.warehouse_id ?? null) as string,
      p_remarks: (write.payload.remarks ?? null) as string,
      p_lines: write.payload.lines as Json,
    }),
  supplier_bills: (supabase, write) =>
    supabase.rpc("fn_create_supplier_bill_idempotent", {
      p_id: write.recordId,
      p_grn_id: write.payload.grn_id as string,
      p_bill_date: write.payload.bill_date as string,
      p_supplier_bill_ref: (write.payload.supplier_bill_ref ?? null) as string,
    }),
  // Phase 4 (Master Offline-First Roadmap) — Delivery Challan (the app's
  // first offline create that DEDUCTS stock, not just adds it) and
  // Invoice. Same reachability constraint as Phases 2-3 — see
  // supabase/migrations/20260914050000_phase29_04_offline_first_fulfillment_billing_create.sql.
  delivery_challans: (supabase, write) =>
    supabase.rpc("fn_create_delivery_challan_idempotent", {
      p_id: write.recordId,
      p_sales_order_id: write.payload.sales_order_id as string,
      p_warehouse_id: write.payload.warehouse_id as string,
      p_delivery_date: write.payload.delivery_date as string,
      p_vehicle_no: (write.payload.vehicle_no ?? null) as string,
      p_driver_name: (write.payload.driver_name ?? null) as string,
      p_remarks: (write.payload.remarks ?? null) as string,
      p_lines: write.payload.lines as Json,
    }),
  invoices: (supabase, write) =>
    supabase.rpc("fn_create_invoice_idempotent", {
      p_id: write.recordId,
      p_sales_order_id: write.payload.sales_order_id as string,
      p_invoice_date: write.payload.invoice_date as string,
      p_lines: write.payload.lines as Json,
    }),
  // Phase 5 (Master Offline-First Roadmap) — the plan's own "highest
  // financial-sensitivity phase": Payment/Receipt, Expense, Bank Account,
  // Petty Cash Fund. See
  // supabase/migrations/20260914060000_phase29_05_offline_first_payments_cash_bank_create.sql
  // for why fn_create_payment_idempotent's allocation re-validation is
  // already safe against a stale offline snapshot, and why batch payments
  // (MultiPaymentForm.tsx) are queued as N independent "payments" creates
  // here rather than one new "batch" RPC.
  payments: (supabase, write) =>
    supabase.rpc("fn_create_payment_idempotent", {
      p_id: write.recordId,
      p_party_id: write.payload.party_id as string,
      p_direction: write.payload.direction as string,
      p_payment_date: write.payload.payment_date as string,
      p_method: (write.payload.method ?? null) as string,
      p_reference_no: (write.payload.reference_no ?? null) as string,
      p_amount: write.payload.amount as number,
      p_notes: (write.payload.notes ?? null) as string,
      p_allocations: (write.payload.allocations ?? []) as Json,
      p_bank_account_id: (write.payload.bank_account_id ?? null) as string,
      p_petty_cash_fund_id: (write.payload.petty_cash_fund_id ?? null) as string,
    }),
  expenses: (supabase, write) =>
    supabase.rpc("fn_create_expense_idempotent", {
      p_id: write.recordId,
      p_expense_date: write.payload.expense_date as string,
      p_expense_head_id: write.payload.expense_head_id as string,
      p_amount: write.payload.amount as number,
      p_payment_source: write.payload.payment_source as string,
      p_bank_account_id: (write.payload.bank_account_id ?? null) as string,
      p_petty_cash_fund_id: (write.payload.petty_cash_fund_id ?? null) as string,
      p_job_id: (write.payload.job_id ?? null) as string,
      p_responsible_user_id: (write.payload.responsible_user_id ?? null) as string,
      p_department: (write.payload.department ?? null) as string,
      p_description: (write.payload.description ?? null) as string,
      p_vehicle_id: (write.payload.vehicle_id ?? null) as string,
      p_odometer_reading: (write.payload.odometer_reading ?? null) as number,
      p_fuel_litres: (write.payload.fuel_litres ?? null) as number,
      p_fuel_rate: (write.payload.fuel_rate ?? null) as number,
      p_settlement_status: (write.payload.settlement_status ?? "Settled") as string,
    }),
  bank_accounts: (supabase, write) =>
    supabase.rpc("fn_create_bank_account_idempotent", {
      p_id: write.recordId,
      p_account_name: write.payload.account_name as string,
      p_bank_name: (write.payload.bank_name ?? null) as string,
      p_account_number: (write.payload.account_number ?? null) as string,
      p_branch: (write.payload.branch ?? null) as string,
      p_opening_balance: (write.payload.opening_balance ?? 0) as number,
      p_opening_balance_date: write.payload.opening_balance_date as string,
    }),
  petty_cash_funds: (supabase, write) =>
    supabase.rpc("fn_create_petty_cash_fund_idempotent", {
      p_id: write.recordId,
      p_fund_name: write.payload.fund_name as string,
      p_custodian_user_id: (write.payload.custodian_user_id ?? null) as string,
      p_opening_balance: (write.payload.opening_balance ?? 0) as number,
      p_opening_balance_date: write.payload.opening_balance_date as string,
    }),
  // Phase 6 (Master Offline-First Roadmap) — Sales Return, Purchase
  // Return, Stock Transfer, Stock Adjustment (request only — approval
  // stays online-only, see this migration's own comment). See
  // supabase/migrations/20260914070000_phase29_06_offline_first_returns_adjustments_create.sql,
  // and 20260914071000_phase29_06b_fix_stock_ledger_txn_type_constraint.sql
  // for a genuine pre-existing bug (blocking these three online too)
  // found and fixed while verifying this phase.
  sales_returns: (supabase, write) =>
    supabase.rpc("fn_create_sales_return_idempotent", {
      p_id: write.recordId,
      p_invoice_id: write.payload.invoice_id as string,
      p_warehouse_id: write.payload.warehouse_id as string,
      p_return_date: write.payload.return_date as string,
      p_reason: write.payload.reason as string,
      p_lines: write.payload.lines as Json,
    }),
  purchase_returns: (supabase, write) =>
    supabase.rpc("fn_create_purchase_return_idempotent", {
      p_id: write.recordId,
      p_supplier_bill_id: write.payload.supplier_bill_id as string,
      p_warehouse_id: write.payload.warehouse_id as string,
      p_return_date: write.payload.return_date as string,
      p_reason: write.payload.reason as string,
      p_lines: write.payload.lines as Json,
    }),
  stock_transfers: (supabase, write) =>
    supabase.rpc("fn_create_stock_transfer_idempotent", {
      p_id: write.recordId,
      p_from_warehouse_id: write.payload.from_warehouse_id as string,
      p_to_warehouse_id: write.payload.to_warehouse_id as string,
      p_transfer_date: write.payload.transfer_date as string,
      p_remarks: (write.payload.remarks ?? null) as string,
      p_lines: write.payload.lines as Json,
    }),
  stock_adjustments: (supabase, write) =>
    supabase.rpc("fn_request_stock_adjustment_idempotent", {
      p_id: write.recordId,
      p_item_id: write.payload.item_id as string,
      p_warehouse_id: write.payload.warehouse_id as string,
      p_qty_delta: write.payload.qty_delta as number,
      p_reason: write.payload.reason as string,
    }),
  // Phase 7 (Master Offline-First Roadmap) — Fabrication/Job module. See
  // supabase/migrations/20260914080000_phase29_07_offline_first_fabrication_create.sql
  // and 20260914081000_phase29_07b_fix_job_cost_ledger_amount_constraint.sql
  // for a second genuine pre-existing bug (Material Return, blocking this
  // phase too) found and fixed while verifying it.
  product_templates: (supabase, write) =>
    supabase.rpc("fn_create_product_template_idempotent", {
      p_id: write.recordId,
      p_template_code: write.payload.template_code as string,
      p_name: write.payload.name as string,
      p_description: (write.payload.description ?? null) as string,
      p_output_item_id: (write.payload.output_item_id ?? null) as string,
      p_output_unit: (write.payload.output_unit ?? null) as string,
      p_lines: write.payload.lines as Json,
    }),
  jobs: (supabase, write) =>
    supabase.rpc("fn_create_job_idempotent", {
      p_id: write.recordId,
      p_sales_order_line_id: write.payload.sales_order_line_id as string,
      p_warehouse_id: write.payload.warehouse_id as string,
      p_product_template_id: (write.payload.product_template_id ?? null) as string,
      p_description: write.payload.description as string,
      p_job_qty: write.payload.job_qty as number,
      p_responsible_user_id: (write.payload.responsible_user_id ?? null) as string,
      p_start_date: (write.payload.start_date ?? null) as string,
      p_required_delivery_date: (write.payload.required_delivery_date ?? null) as string,
      p_material_lines: write.payload.material_lines as Json,
    }),
  stock_reservations: (supabase, write) =>
    supabase.rpc("fn_reserve_job_material_idempotent", {
      p_id: write.recordId,
      p_job_id: write.payload.job_id as string,
      p_item_id: write.payload.item_id as string,
      p_warehouse_id: write.payload.warehouse_id as string,
      p_qty: write.payload.qty as number,
    }),
  job_material_issues: (supabase, write) =>
    supabase.rpc("fn_issue_job_material_idempotent", {
      p_id: write.recordId,
      p_job_id: write.payload.job_id as string,
      p_item_id: write.payload.item_id as string,
      p_qty: write.payload.qty as number,
    }),
  job_material_returns: (supabase, write) =>
    supabase.rpc("fn_return_job_material_idempotent", {
      p_id: write.recordId,
      p_job_id: write.payload.job_id as string,
      p_item_id: write.payload.item_id as string,
      p_qty: write.payload.qty as number,
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
