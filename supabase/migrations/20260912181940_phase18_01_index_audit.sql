-- ============================================================
-- Phase 18 Part A.1 — Database index audit.
--
-- Every statement is idempotent (create index if not exists / drop
-- index if exists) so this file is safe to re-run.
--
-- Found via a live audit: every single-column FK in the public schema
-- checked against pg_index for whether it's the leftmost column of any
-- existing index (leftmost-prefix rule — that's what actually matters
-- for whether a lookup on that column alone can use an index).
-- ============================================================

-- ---------- 1. Drop the one genuine duplicate index found ----------
-- daily_snapshots already has a UNIQUE index on snapshot_date
-- (daily_snapshots_snapshot_date_key) from its own UNIQUE constraint;
-- a plain btree can be scanned backwards just as cheaply, so a second,
-- DESC-only index on the same single column added no real value.
-- (idx_qrev_one_current / idx_qrev_quotation on quotation_revisions
-- were checked too and are NOT duplicates — one is a partial UNIQUE
-- index enforcing "exactly one current revision", the other a plain
-- index for "all revisions of a quotation" — both kept.)
drop index if exists public.idx_daily_snapshots_date;

-- ---------- 2. Missing foreign-key indexes ----------
-- audit_by / updated_by / created_by columns included even though
-- low-traffic, per the prompt's literal "every FK column" instruction.
create index if not exists idx_bank_accounts_created_by on public.bank_accounts (created_by);
create index if not exists idx_bank_accounts_updated_by on public.bank_accounts (updated_by);

create index if not exists idx_contra_transfers_created_by on public.contra_transfers (created_by);
create index if not exists idx_contra_transfers_from_bank_account_id on public.contra_transfers (from_bank_account_id);
create index if not exists idx_contra_transfers_from_petty_cash_fund_id on public.contra_transfers (from_petty_cash_fund_id);
create index if not exists idx_contra_transfers_journal_entry_id on public.contra_transfers (journal_entry_id);
create index if not exists idx_contra_transfers_to_bank_account_id on public.contra_transfers (to_bank_account_id);
create index if not exists idx_contra_transfers_to_petty_cash_fund_id on public.contra_transfers (to_petty_cash_fund_id);
create index if not exists idx_contra_transfers_updated_by on public.contra_transfers (updated_by);

create index if not exists idx_daily_snapshots_generated_by on public.daily_snapshots (generated_by);

create index if not exists idx_expense_heads_account_code on public.expense_heads (account_code);
create index if not exists idx_expense_heads_created_by on public.expense_heads (created_by);
create index if not exists idx_expense_heads_updated_by on public.expense_heads (updated_by);

create index if not exists idx_expenses_bank_account_id on public.expenses (bank_account_id);
create index if not exists idx_expenses_created_by on public.expenses (created_by);
create index if not exists idx_expenses_expense_head_id on public.expenses (expense_head_id);
create index if not exists idx_expenses_job_id on public.expenses (job_id);
create index if not exists idx_expenses_petty_cash_fund_id on public.expenses (petty_cash_fund_id);
create index if not exists idx_expenses_responsible_user_id on public.expenses (responsible_user_id);
create index if not exists idx_expenses_updated_by on public.expenses (updated_by);

create index if not exists idx_item_alt_units_created_by on public.item_alt_units (created_by);
create index if not exists idx_item_alt_units_unit on public.item_alt_units (unit);

create index if not exists idx_payments_bank_account_id on public.payments (bank_account_id);
create index if not exists idx_payments_petty_cash_fund_id on public.payments (petty_cash_fund_id);

create index if not exists idx_petty_cash_funds_created_by on public.petty_cash_funds (created_by);
create index if not exists idx_petty_cash_funds_custodian_user_id on public.petty_cash_funds (custodian_user_id);
create index if not exists idx_petty_cash_funds_updated_by on public.petty_cash_funds (updated_by);

create index if not exists idx_purchase_return_lines_item_id on public.purchase_return_lines (item_id);
create index if not exists idx_purchase_return_lines_supplier_bill_line_id on public.purchase_return_lines (supplier_bill_line_id);

create index if not exists idx_purchase_returns_created_by on public.purchase_returns (created_by);
create index if not exists idx_purchase_returns_supplier_id on public.purchase_returns (supplier_id);
create index if not exists idx_purchase_returns_updated_by on public.purchase_returns (updated_by);
create index if not exists idx_purchase_returns_warehouse_id on public.purchase_returns (warehouse_id);

create index if not exists idx_role_permissions_updated_by on public.role_permissions (updated_by);

create index if not exists idx_sales_return_lines_invoice_line_id on public.sales_return_lines (invoice_line_id);
create index if not exists idx_sales_return_lines_item_id on public.sales_return_lines (item_id);

create index if not exists idx_sales_returns_created_by on public.sales_returns (created_by);
create index if not exists idx_sales_returns_party_id on public.sales_returns (party_id);
create index if not exists idx_sales_returns_sales_order_id on public.sales_returns (sales_order_id);
create index if not exists idx_sales_returns_updated_by on public.sales_returns (updated_by);
create index if not exists idx_sales_returns_warehouse_id on public.sales_returns (warehouse_id);

create index if not exists idx_stock_transfer_lines_item_id on public.stock_transfer_lines (item_id);

create index if not exists idx_stock_transfers_created_by on public.stock_transfers (created_by);
create index if not exists idx_stock_transfers_updated_by on public.stock_transfers (updated_by);

create index if not exists idx_tasks_completed_by on public.tasks (completed_by);
create index if not exists idx_tasks_created_by on public.tasks (created_by);
create index if not exists idx_tasks_updated_by on public.tasks (updated_by);

create index if not exists idx_vehicles_assigned_user_id on public.vehicles (assigned_user_id);
create index if not exists idx_vehicles_created_by on public.vehicles (created_by);
create index if not exists idx_vehicles_updated_by on public.vehicles (updated_by);

-- ---------- 3. "Most recent first" indexes ----------
-- Every one of these tables' own list page does
-- .order("created_at", { ascending: false }) (or the equivalent) with
-- no existing index behind it at all — a full-table sort on every page
-- load. None of these tables use soft-delete (this schema uses
-- status/is_active instead), so a plain DESC index is the right shape
-- here (a composite "status + date" index would help only the handful
-- of screens that also filter by status, and those already have a
-- separate status index from Part 2/existing indexes).
create index if not exists idx_queries_created_at on public.queries (created_at desc);
create index if not exists idx_quotations_created_at on public.quotations (created_at desc);
create index if not exists idx_sales_orders_created_at on public.sales_orders (created_at desc);
create index if not exists idx_purchase_orders_created_at on public.purchase_orders (created_at desc);
create index if not exists idx_jobs_created_at on public.jobs (created_at desc);
create index if not exists idx_delivery_challans_created_at on public.delivery_challans (created_at desc);
create index if not exists idx_invoices_created_at on public.invoices (created_at desc);
create index if not exists idx_supplier_bills_created_at on public.supplier_bills (created_at desc);
create index if not exists idx_payments_created_at on public.payments (created_at desc);
create index if not exists idx_expenses_created_at on public.expenses (created_at desc);
create index if not exists idx_contra_transfers_created_at on public.contra_transfers (created_at desc);
create index if not exists idx_stock_transfers_created_at on public.stock_transfers (created_at desc);
create index if not exists idx_sales_returns_created_at on public.sales_returns (created_at desc);
create index if not exists idx_purchase_returns_created_at on public.purchase_returns (created_at desc);
create index if not exists idx_tasks_created_at on public.tasks (created_at desc);
create index if not exists idx_activity_timeline_at on public.activity_timeline ("at" desc);

-- ---------- 4. Master-data list ordering ----------
create index if not exists idx_parties_legal_name on public.parties (legal_name);

-- ---------- 5. Business-uniqueness guard ----------
-- Nothing currently enforces two clients/suppliers can't be entered
-- under the same name (case/whitespace aside) — a real duplicate-data
-- risk this business already has to watch for manually. Verified zero
-- existing collisions before adding this (see audit notes).
create unique index if not exists idx_parties_legal_name_unique on public.parties (lower(trim(legal_name)));
