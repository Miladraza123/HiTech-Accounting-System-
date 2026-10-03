-- Phase 40.01 — Service/Repair module.
--
-- The client also repairs/services customer-owned machine parts: the
-- customer's own part arrives with the CUSTOMER's own Delivery Challan (an
-- incoming receipt, which needs recording); once repaired, the company
-- issues its OWN outgoing delivery and a Service Invoice (not a normal
-- sales invoice — no stock sold, no Sales Order behind it).
--
-- Deliberately built as its own small, parallel pipeline rather than
-- reusing sales_orders/delivery_challans/invoices:
--   - sales_orders.quotation_id/query_id are NOT NULL — a Service Job has
--     neither, and fabricating a dummy Query+Quotation chain just to
--     satisfy that would be a hack, not a design.
--   - delivery_challan_lines/invoice_lines.sales_order_line_id are NOT
--     NULL — every existing DC/Invoice line reconciles against a specific
--     Sales Order line's ordered/delivered/invoiced quantities. A repair's
--     charges (labor + whatever parts were used) have nothing to
--     reconcile against; forcing that NOT NULL to become nullable would
--     touch fn_create_invoice/fn_create_delivery_challan's core
--     qty-validation logic — exactly the kind of already-proven,
--     financially-sensitive code this program has otherwise been careful
--     never to destabilize.
-- This way the entire module is purely additive: zero changes to any
-- existing table, column, or function.
--
-- Scope, disclosed up front: Service Invoices post correctly to the GL
-- (show in Trial Balance/P&L/General Ledger/Party Ledger, all of which are
-- journal-based) and the party's own page, but are NOT yet wired into
-- fn_allocate_payment's bill-wise allocation table — that function is a
-- frequently-revised, advisory-locked, financially-critical RPC, and
-- extending it is a deliberately separate follow-up rather than bundled
-- in here. A receipt against a Service Invoice today works the same way
-- an unallocated/on-account receipt already does for any client.

create table public.service_jobs (
  id uuid primary key default gen_random_uuid(),
  job_no text not null unique,
  party_id uuid not null references public.parties(id),
  customer_dc_no text,
  customer_dc_date date,
  asset_description text not null,
  received_condition_notes text,
  status text not null default 'Received' check (status in ('Received', 'Completed', 'Delivered', 'Cancelled')),
  responsible_user_id uuid references auth.users(id),
  cancel_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  row_version bigint not null default 1
);
create index idx_svj_party on public.service_jobs(party_id);
create index idx_svj_status on public.service_jobs(status);
create index idx_svj_created_by on public.service_jobs(created_by);

create table public.service_deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_no text not null unique,
  service_job_id uuid not null references public.service_jobs(id),
  party_id uuid not null references public.parties(id),
  delivery_date date not null default current_date,
  vehicle_no text,
  driver_name text,
  remarks text,
  status text not null default 'Issued' check (status in ('Issued', 'Cancelled')),
  cancel_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  row_version bigint not null default 1
);
create index idx_svd_job on public.service_deliveries(service_job_id);
create index idx_svd_party on public.service_deliveries(party_id);

create table public.service_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  service_job_id uuid not null references public.service_jobs(id),
  party_id uuid not null references public.parties(id),
  invoice_date date not null default current_date,
  subtotal numeric(18, 2) not null default 0,
  tax_total numeric(18, 2) not null default 0,
  grand_total numeric(18, 2) not null default 0,
  status text not null default 'Posted' check (status in ('Posted', 'Cancelled')),
  cancel_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  row_version bigint not null default 1
);
create index idx_svi_job on public.service_invoices(service_job_id);
create index idx_svi_party on public.service_invoices(party_id);
create index idx_svi_status on public.service_invoices(status);

create table public.service_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  service_invoice_id uuid not null references public.service_invoices(id) on delete cascade,
  description text not null,
  qty numeric(18, 3) not null default 1 check (qty > 0),
  rate numeric(18, 2) not null default 0,
  tax_pct numeric(5, 2) not null default 0,
  amount numeric(18, 2) generated always as (round(qty * rate, 2)) stored,
  sort_order int not null default 0
);
create index idx_svil_invoice on public.service_invoice_lines(service_invoice_id);

create trigger trg_updated_at before update on public.service_jobs for each row execute function public.fn_set_updated_at();
create trigger trg_audit after insert or update or delete on public.service_jobs for each row execute function public.fn_audit_row();
create trigger trg_updated_at before update on public.service_deliveries for each row execute function public.fn_set_updated_at();
create trigger trg_audit after insert or update or delete on public.service_deliveries for each row execute function public.fn_audit_row();
create trigger trg_updated_at before update on public.service_invoices for each row execute function public.fn_set_updated_at();
create trigger trg_audit after insert or update or delete on public.service_invoices for each row execute function public.fn_audit_row();

alter table public.service_jobs enable row level security;
alter table public.service_deliveries enable row level security;
alter table public.service_invoices enable row level security;
alter table public.service_invoice_lines enable row level security;

-- Service Job / Delivery: operational, not financial — everyone reads,
-- same as sales_orders/delivery_challans before the finance-only hardening
-- (which only ever applied to Payments/Invoices/Bills and their lines).
create policy p_select on public.service_jobs for select to authenticated using (true);
create policy p_insert on public.service_jobs for insert to authenticated
  with check (public.is_owner() or public.has_role('sales') or public.has_role('store'));
create policy p_update on public.service_jobs for update to authenticated
  using (public.is_owner() or public.has_role('sales') or public.has_role('store'))
  with check (public.is_owner() or public.has_role('sales') or public.has_role('store'));

create policy p_select on public.service_deliveries for select to authenticated using (true);
create policy p_insert on public.service_deliveries for insert to authenticated
  with check (public.is_owner() or public.has_role('dispatch'));
create policy p_update on public.service_deliveries for update to authenticated
  using (public.is_owner() or public.has_role('dispatch'))
  with check (public.is_owner() or public.has_role('dispatch'));

-- Service Invoice: financial — mirrors invoices' own restricted read
-- (owner/accounts/auditor/sales) from the finance-hardening migration.
create policy p_select on public.service_invoices for select to authenticated
  using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor') or public.has_role('sales'));
create policy p_insert on public.service_invoices for insert to authenticated
  with check (public.is_owner() or public.has_role('accounts'));
create policy p_update on public.service_invoices for update to authenticated
  using (public.is_owner() or public.has_role('accounts'))
  with check (public.is_owner() or public.has_role('accounts'));

create policy p_select on public.service_invoice_lines for select to authenticated
  using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor') or public.has_role('sales'));
create policy p_insert on public.service_invoice_lines for insert to authenticated
  with check (public.is_owner() or public.has_role('accounts'));

insert into public.chart_of_accounts (code, name, account_type, is_system)
values ('4020', 'Service Revenue', 'income', true)
on conflict (code) do nothing;

insert into public.numbering_sequences (doc_type, label, prefix, fy_reset, padding)
values
  ('SVJ', 'Service Job', 'SVJ-', true, 4),
  ('SVD', 'Service Delivery', 'SVD-', true, 4),
  ('SVI', 'Service Invoice', 'SVI-', true, 4)
on conflict (doc_type) do nothing;
