create table public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  so_no text not null unique,
  quotation_id uuid not null references public.quotations(id),
  query_id uuid not null references public.queries(id),
  party_id uuid not null references public.parties(id),
  client_po_number text not null,
  po_date date not null default current_date,
  delivery_schedule date,
  payment_terms text,
  business_line text not null check (business_line in ('material_supply','fabrication')),
  responsible_user_id uuid references auth.users(id),
  status text not null default 'Confirmed'
    check (status in ('Confirmed','InProgress','PartiallyDelivered','Delivered','Invoiced','Closed','Cancelled')),
  subtotal numeric(18,2) not null default 0,
  tax_total numeric(18,2) not null default 0,
  grand_total numeric(18,2) not null default 0,
  cancel_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  row_version bigint not null default 1
);
create index idx_so_party on public.sales_orders(party_id);
create index idx_so_quotation on public.sales_orders(quotation_id);
create index idx_so_query on public.sales_orders(query_id);
create index idx_so_status on public.sales_orders(status);
create index idx_so_created_by on public.sales_orders(created_by);
create index idx_so_updated_by on public.sales_orders(updated_by);
create index idx_so_responsible on public.sales_orders(responsible_user_id);
-- Duplicate PO detection: same client + same PO number (warned in the app, not hard-blocked here)
create index idx_so_party_po on public.sales_orders(party_id, client_po_number);

-- Live, mutable order lines — stable ids so later GRN/DC/Invoice phases can
-- track delivered_qty / invoiced_qty against the SAME row across amendments.
create table public.sales_order_lines (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  item_id uuid references public.items(id),
  description text not null,
  ordered_qty numeric(18,3) not null check (ordered_qty > 0),
  unit text references public.units(code),
  rate numeric(18,4) not null check (rate >= 0),
  tax_pct numeric(5,2) not null default 0,
  amount numeric(18,2) generated always as (round(ordered_qty * rate, 2)) stored,
  delivered_qty numeric(18,3) not null default 0,
  invoiced_qty numeric(18,3) not null default 0,
  sort_order int not null default 0,
  check (delivered_qty >= 0 and delivered_qty <= ordered_qty),
  check (invoiced_qty >= 0)
);
create index idx_sol_so on public.sales_order_lines(sales_order_id);
create index idx_sol_item on public.sales_order_lines(item_id);
create index idx_sol_unit on public.sales_order_lines(unit);

-- Amendment history: a JSONB snapshot of the header+lines taken right
-- BEFORE each amendment is applied. The PO is never silently overwritten.
create table public.sales_order_revisions (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  rev_no int not null,
  reason text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (sales_order_id, rev_no)
);
create index idx_sor_so on public.sales_order_revisions(sales_order_id);
create index idx_sor_created_by on public.sales_order_revisions(created_by);

create trigger trg_updated_at before update on public.sales_orders for each row execute function public.fn_set_updated_at();
create trigger trg_audit after insert or update or delete on public.sales_orders for each row execute function public.fn_audit_row();
create trigger trg_audit after insert or update or delete on public.sales_order_lines for each row execute function public.fn_audit_row();
