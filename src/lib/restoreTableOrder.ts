// The exact table list + dependency order (parents before children) used
// by both the standalone Daily Backup script (backup/backup.js — kept in
// sync manually there, since that script deliberately lives outside this
// app's bundle) and the in-app Restore feature. Insert/merge replays this
// list forward; a "replace" restore's orphan-delete pass replays it
// reversed, so a child row's FK never blocks deleting its soon-to-be-gone
// parent.
export const RESTORE_TABLE_ORDER = [
  "activity_timeline", "attachments", "audit_log", "bank_accounts", "chart_of_accounts",
  "daily_snapshots", "import_batches", "journal_entries", "login_sessions", "numbering_sequences",
  "profiles", "provinces", "query_sources", "role_permissions", "roles", "units", "warehouses",
  "company", "expense_heads", "items", "parties", "petty_cash_funds", "stock_transfers", "tasks",
  "unit_conversions", "user_roles", "vehicles", "contra_transfers", "item_alt_units", "journal_lines",
  "party_contacts", "payments", "product_templates", "queries", "stock_adjustments", "stock_ledger",
  "stock_transfer_lines", "product_template_lines", "quotations", "quotation_revisions", "sales_orders",
  "delivery_challans", "invoices", "purchase_orders", "quotation_lines", "sales_order_lines",
  "sales_order_revisions", "delivery_challan_lines", "grns", "invoice_lines", "jobs",
  "purchase_order_lines", "sales_returns", "expenses", "grn_lines", "job_cost_ledger",
  "job_material_requirements", "sales_return_lines", "stock_reservations", "supplier_bills",
  "payment_allocations", "purchase_returns", "supplier_bill_lines", "purchase_return_lines",
] as const;

export type RestoreTableName = (typeof RESTORE_TABLE_ORDER)[number];
