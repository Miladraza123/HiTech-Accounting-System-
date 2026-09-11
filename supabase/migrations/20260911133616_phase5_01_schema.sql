-- New document type for Supplier Bill booking (Phase 3's deferred item)
insert into public.numbering_sequences (doc_type, label, prefix, fy_reset, padding) values
  ('BILL', 'Supplier Bill', 'BILL-', true, 4);

-- ============================================================
-- Delivery Challan + Client Acceptance / POD
-- ============================================================
create table public.delivery_challans (
  id uuid primary key default gen_random_uuid(),
  dc_no text not null unique,
  sales_order_id uuid not null references public.sales_orders(id),
  party_id uuid not null references public.parties(id),
  warehouse_id uuid not null references public.warehouses(id),
  delivery_date date not null default current_date,
  vehicle_no text,
  driver_name text,
  remarks text,
  status text not null default 'Issued' check (status in ('Issued','Cancelled')),
  acceptance_status text not null default 'Pending' check (acceptance_status in ('Pending','Accepted','Disputed')),
  accepted_by_name text,
  accepted_at timestamptz,
  dispute_note text,
  cancel_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  row_version bigint not null default 1
);
create index idx_dc_so on public.delivery_challans(sales_order_id);
create index idx_dc_party on public.delivery_challans(party_id);
create index idx_dc_warehouse on public.delivery_challans(warehouse_id);
create index idx_dc_status on public.delivery_challans(status);
create index idx_dc_acceptance on public.delivery_challans(acceptance_status);
create index idx_dc_created_by on public.delivery_challans(created_by);
create index idx_dc_updated_by on public.delivery_challans(updated_by);

create table public.delivery_challan_lines (
  id uuid primary key default gen_random_uuid(),
  dc_id uuid not null references public.delivery_challans(id) on delete cascade,
  sales_order_line_id uuid not null references public.sales_order_lines(id),
  item_id uuid references public.items(id),
  description text not null,
  delivered_qty numeric(18,3) not null check (delivered_qty > 0),
  unit text references public.units(code),
  issue_from_stock boolean not null default false,
  sort_order int not null default 0
);
create index idx_dcl_dc on public.delivery_challan_lines(dc_id);
create index idx_dcl_so_line on public.delivery_challan_lines(sales_order_line_id);
create index idx_dcl_item on public.delivery_challan_lines(item_id);
create index idx_dcl_unit on public.delivery_challan_lines(unit);

create trigger trg_updated_at before update on public.delivery_challans for each row execute function public.fn_set_updated_at();
create trigger trg_audit after insert or update or delete on public.delivery_challans for each row execute function public.fn_audit_row();

-- ============================================================
-- GST Invoice & Billing (Accounts Receivable side)
-- ============================================================
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  sales_order_id uuid not null references public.sales_orders(id),
  party_id uuid not null references public.parties(id),
  invoice_date date not null default current_date,
  subtotal numeric(18,2) not null default 0,
  tax_total numeric(18,2) not null default 0,
  grand_total numeric(18,2) not null default 0,
  status text not null default 'Posted' check (status in ('Posted','Cancelled')),
  cancel_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  row_version bigint not null default 1
);
create index idx_inv_so on public.invoices(sales_order_id);
create index idx_inv_party on public.invoices(party_id);
create index idx_inv_status on public.invoices(status);
create index idx_inv_created_by on public.invoices(created_by);
create index idx_inv_updated_by on public.invoices(updated_by);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  sales_order_line_id uuid not null references public.sales_order_lines(id),
  item_id uuid references public.items(id),
  description text not null,
  qty numeric(18,3) not null check (qty > 0),
  unit text references public.units(code),
  rate numeric(18,2) not null default 0,
  tax_pct numeric(5,2) not null default 0,
  amount numeric(18,2) generated always as (round(qty * rate, 2)) stored,
  sort_order int not null default 0
);
create index idx_invl_invoice on public.invoice_lines(invoice_id);
create index idx_invl_so_line on public.invoice_lines(sales_order_line_id);
create index idx_invl_item on public.invoice_lines(item_id);
create index idx_invl_unit on public.invoice_lines(unit);

create trigger trg_updated_at before update on public.invoices for each row execute function public.fn_set_updated_at();
create trigger trg_audit after insert or update or delete on public.invoices for each row execute function public.fn_audit_row();

-- ============================================================
-- Supplier Bill booking (Accounts Payable side — deferred from Phase 3;
-- clears GRN Clearing (1330) into Trade Payables (2100), 'stock'
-- purchase-type GRNs only — 'direct'/'general' already booked Trade
-- Payables straight at receiving time, see phase3_04's fn_create_grn).
-- ============================================================
create table public.supplier_bills (
  id uuid primary key default gen_random_uuid(),
  bill_no text not null unique,
  supplier_id uuid not null references public.parties(id),
  purchase_order_id uuid references public.purchase_orders(id),
  grn_id uuid references public.grns(id),
  bill_date date not null default current_date,
  supplier_bill_ref text,
  subtotal numeric(18,2) not null default 0,
  tax_total numeric(18,2) not null default 0,
  grand_total numeric(18,2) not null default 0,
  status text not null default 'Posted' check (status in ('Posted','Cancelled')),
  cancel_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  row_version bigint not null default 1
);
create unique index uq_supplier_bill_grn on public.supplier_bills(grn_id) where status <> 'Cancelled';
create index idx_sb_supplier on public.supplier_bills(supplier_id);
create index idx_sb_po on public.supplier_bills(purchase_order_id);
create index idx_sb_status on public.supplier_bills(status);
create index idx_sb_created_by on public.supplier_bills(created_by);
create index idx_sb_updated_by on public.supplier_bills(updated_by);

create table public.supplier_bill_lines (
  id uuid primary key default gen_random_uuid(),
  supplier_bill_id uuid not null references public.supplier_bills(id) on delete cascade,
  grn_line_id uuid references public.grn_lines(id),
  item_id uuid references public.items(id),
  description text not null,
  qty numeric(18,3) not null check (qty > 0),
  rate numeric(18,2) not null default 0,
  tax_pct numeric(5,2) not null default 0,
  amount numeric(18,2) generated always as (round(qty * rate, 2)) stored,
  sort_order int not null default 0
);
create index idx_sbl_bill on public.supplier_bill_lines(supplier_bill_id);
create index idx_sbl_grn_line on public.supplier_bill_lines(grn_line_id);
create index idx_sbl_item on public.supplier_bill_lines(item_id);

create trigger trg_updated_at before update on public.supplier_bills for each row execute function public.fn_set_updated_at();
create trigger trg_audit after insert or update or delete on public.supplier_bills for each row execute function public.fn_audit_row();

-- ============================================================
-- Bill-wise Payment & Recovery — one table covers both directions
-- (customer receipt against an Invoice, supplier payment against a
-- Supplier Bill), matching the single 'PAY' numbering sequence already
-- seeded in Phase 0.
-- ============================================================
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  payment_no text not null unique,
  party_id uuid not null references public.parties(id),
  direction text not null check (direction in ('receipt','payment')),
  payment_date date not null default current_date,
  method text,
  reference_no text,
  amount numeric(18,2) not null check (amount > 0),
  unallocated_amount numeric(18,2) not null default 0,
  notes text,
  status text not null default 'Posted' check (status in ('Posted','Cancelled')),
  cancel_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  row_version bigint not null default 1
);
create index idx_pay_party on public.payments(party_id);
create index idx_pay_direction on public.payments(direction);
create index idx_pay_status on public.payments(status);
create index idx_pay_created_by on public.payments(created_by);
create index idx_pay_updated_by on public.payments(updated_by);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  invoice_id uuid references public.invoices(id),
  supplier_bill_id uuid references public.supplier_bills(id),
  amount numeric(18,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  check ((invoice_id is not null and supplier_bill_id is null) or (invoice_id is null and supplier_bill_id is not null))
);
create index idx_pa_payment on public.payment_allocations(payment_id);
create index idx_pa_invoice on public.payment_allocations(invoice_id);
create index idx_pa_supplier_bill on public.payment_allocations(supplier_bill_id);

create trigger trg_updated_at before update on public.payments for each row execute function public.fn_set_updated_at();
create trigger trg_audit after insert or update or delete on public.payments for each row execute function public.fn_audit_row();

-- ============================================================
-- Outstanding-balance views — "bill-wise" recovery needs to know what's
-- still owed per Invoice / Supplier Bill. security_invoker=true from the
-- start this time (Phase 4 had to fix this after the fact).
-- ============================================================
create or replace view public.invoice_outstanding as
select
  i.id as invoice_id,
  i.party_id,
  i.grand_total,
  coalesce(sum(pa.amount) filter (where p.status = 'Posted'), 0) as allocated_amount,
  i.grand_total - coalesce(sum(pa.amount) filter (where p.status = 'Posted'), 0) as outstanding_amount
from public.invoices i
left join public.payment_allocations pa on pa.invoice_id = i.id
left join public.payments p on p.id = pa.payment_id
where i.status = 'Posted'
group by i.id, i.party_id, i.grand_total;

alter view public.invoice_outstanding set (security_invoker = true);
grant select on public.invoice_outstanding to authenticated;

create or replace view public.supplier_bill_outstanding as
select
  b.id as supplier_bill_id,
  b.supplier_id,
  b.grand_total,
  coalesce(sum(pa.amount) filter (where p.status = 'Posted'), 0) as allocated_amount,
  b.grand_total - coalesce(sum(pa.amount) filter (where p.status = 'Posted'), 0) as outstanding_amount
from public.supplier_bills b
left join public.payment_allocations pa on pa.supplier_bill_id = b.id
left join public.payments p on p.id = pa.payment_id
where b.status = 'Posted'
group by b.id, b.supplier_id, b.grand_total;

alter view public.supplier_bill_outstanding set (security_invoker = true);
grant select on public.supplier_bill_outstanding to authenticated;
