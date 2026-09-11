-- New COA account for non-stocked "General Purchase" expenses (§5 category
-- that isn't Raw Material and isn't a specific client order)
insert into public.chart_of_accounts (code, name, account_type, is_system) values
  ('5800', 'General Purchases', 'expense', true);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_no text not null unique,
  supplier_id uuid not null references public.parties(id),
  purchase_type text not null check (purchase_type in ('direct','stock','general')),
  linked_sales_order_id uuid references public.sales_orders(id),
  warehouse_id uuid references public.warehouses(id),
  expected_delivery date,
  responsible_user_id uuid references auth.users(id),
  status text not null default 'Confirmed'
    check (status in ('Confirmed','PartiallyReceived','Received','Closed','Cancelled')),
  subtotal numeric(18,2) not null default 0,
  tax_total numeric(18,2) not null default 0,
  grand_total numeric(18,2) not null default 0,
  cancel_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  row_version bigint not null default 1,
  -- 'direct' purchases are always against a specific client Sales Order;
  -- 'stock' purchases need a target warehouse.
  check (purchase_type <> 'direct' or linked_sales_order_id is not null),
  check (purchase_type <> 'stock' or warehouse_id is not null)
);
create index idx_po_supplier on public.purchase_orders(supplier_id);
create index idx_po_so on public.purchase_orders(linked_sales_order_id);
create index idx_po_warehouse on public.purchase_orders(warehouse_id);
create index idx_po_status on public.purchase_orders(status);
create index idx_po_created_by on public.purchase_orders(created_by);
create index idx_po_updated_by on public.purchase_orders(updated_by);
create index idx_po_responsible on public.purchase_orders(responsible_user_id);

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_id uuid references public.items(id),
  description text not null,
  ordered_qty numeric(18,3) not null check (ordered_qty > 0),
  unit text references public.units(code),
  rate numeric(18,4) not null check (rate >= 0),
  tax_pct numeric(5,2) not null default 0,
  amount numeric(18,2) generated always as (round(ordered_qty * rate, 2)) stored,
  received_qty numeric(18,3) not null default 0,
  sort_order int not null default 0
);
create index idx_pol_po on public.purchase_order_lines(purchase_order_id);
create index idx_pol_item on public.purchase_order_lines(item_id);
create index idx_pol_unit on public.purchase_order_lines(unit);

create table public.grns (
  id uuid primary key default gen_random_uuid(),
  grn_no text not null unique,
  supplier_id uuid not null references public.parties(id),
  purchase_order_id uuid not null references public.purchase_orders(id),
  received_date date not null default current_date,
  warehouse_id uuid references public.warehouses(id),
  remarks text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index idx_grn_po on public.grns(purchase_order_id);
create index idx_grn_supplier on public.grns(supplier_id);
create index idx_grn_warehouse on public.grns(warehouse_id);
create index idx_grn_created_by on public.grns(created_by);

create table public.grn_lines (
  id uuid primary key default gen_random_uuid(),
  grn_id uuid not null references public.grns(id) on delete cascade,
  po_line_id uuid not null references public.purchase_order_lines(id),
  ordered_qty numeric(18,3) not null,
  previously_received_qty numeric(18,3) not null default 0,
  this_receipt_qty numeric(18,3) not null check (this_receipt_qty > 0),
  total_received_qty numeric(18,3) generated always as (previously_received_qty + this_receipt_qty) stored,
  short_excess_qty numeric(18,3) generated always as (previously_received_qty + this_receipt_qty - ordered_qty) stored,
  rate numeric(18,4) not null,
  tax_pct numeric(5,2) not null default 0,
  unit text,
  item_id uuid references public.items(id)
);
create index idx_grnl_grn on public.grn_lines(grn_id);
create index idx_grnl_po_line on public.grn_lines(po_line_id);
create index idx_grnl_item on public.grn_lines(item_id);

-- Append-only stock ledger — single source of truth for current stock.
-- running_balance / avg_cost are computed and stamped by the posting
-- function below, never written directly.
create table public.stock_ledger (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id),
  warehouse_id uuid not null references public.warehouses(id),
  txn_type text not null check (txn_type in ('GRN','Issue','Return','DC','Adjustment','OpeningStock')),
  qty numeric(18,3) not null check (qty <> 0),
  rate numeric(18,4) not null default 0,
  running_balance numeric(18,3) not null,
  avg_cost numeric(18,4) not null default 0,
  ref_table text,
  ref_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index idx_stock_ledger_item_wh on public.stock_ledger(item_id, warehouse_id, created_at, id);
create index idx_stock_ledger_ref on public.stock_ledger(ref_table, ref_id);
create index idx_stock_ledger_created_by on public.stock_ledger(created_by);

create table public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id),
  warehouse_id uuid not null references public.warehouses(id),
  qty_delta numeric(18,3) not null check (qty_delta <> 0),
  reason text not null,
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected')),
  requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text
);
create index idx_stockadj_item_wh on public.stock_adjustments(item_id, warehouse_id);
create index idx_stockadj_status on public.stock_adjustments(status);
create index idx_stockadj_requested_by on public.stock_adjustments(requested_by);
create index idx_stockadj_decided_by on public.stock_adjustments(decided_by);

create trigger trg_updated_at before update on public.purchase_orders for each row execute function public.fn_set_updated_at();
create trigger trg_audit after insert or update or delete on public.purchase_orders for each row execute function public.fn_audit_row();
create trigger trg_audit after insert or update or delete on public.purchase_order_lines for each row execute function public.fn_audit_row();
create trigger trg_audit after insert or update or delete on public.stock_adjustments for each row execute function public.fn_audit_row();
