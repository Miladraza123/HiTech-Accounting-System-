-- ============================================================
-- Phase 14: Sales & Purchase Returns (Rejection / Replacement is
-- deliberately NOT a separate transaction type — a "replacement" is a
-- Return followed by a normal new Delivery Challan / GRN of the
-- replacement stock, reusing everything that already exists rather than
-- duplicating the return/reversal logic for what is really the same
-- reverse-then-forward flow. "Rejection" at receiving time is already
-- covered by GRN short/excess tracking from Phase 3; a Purchase Return
-- here covers goods rejected/returned AFTER they were received & billed.)
--
-- Design: both Return types are tied to the specific financial document
-- that first booked the money (Sales Return -> a Posted Invoice,
-- Purchase Return -> a Posted Supplier Bill), exactly mirroring how a
-- real credit/debit note works, and reuse the SAME invoiced_qty/
-- returned_qty style running-counter pattern already used everywhere
-- else in this schema (ordered_qty/delivered_qty/invoiced_qty). This
-- lets invoice_outstanding / supplier_bill_outstanding (and everything
-- built on them: AR/AP Aging, Customer 360, credit-limit checks) net
-- returns in for free with a small, additive view change instead of a
-- parallel outstanding-balance system.
--
-- Purchase Return is scoped to 'stock'-type purchases only (the only
-- type that goes through a separate Supplier Bill and actually moves
-- inventory) — a 'direct'/'general' purchase books its Payable straight
-- off the GRN with no stock effect, so a correction there is a Journal
-- Voucher (already exists), not a stock-reversing Return.
-- ============================================================

insert into public.numbering_sequences (doc_type, label, prefix, fy_reset, padding, current_value)
values
  ('SRN', 'Sales Return', 'SRN-', true, 4, 0),
  ('PRN', 'Purchase Return', 'PRN-', true, 4, 0);

alter table public.invoice_lines add column returned_qty numeric not null default 0;
alter table public.supplier_bill_lines add column returned_qty numeric not null default 0;

-- ---- Sales Returns ----

create table public.sales_returns (
  id uuid primary key default gen_random_uuid(),
  return_no text not null unique,
  invoice_id uuid not null references public.invoices(id),
  sales_order_id uuid not null references public.sales_orders(id),
  party_id uuid not null references public.parties(id),
  warehouse_id uuid not null references public.warehouses(id),
  return_date date not null default current_date,
  reason text not null,
  status text not null default 'Posted' check (status in ('Posted','Cancelled')),
  subtotal numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  cancel_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

comment on table public.sales_returns is 'Credit note against a Posted Invoice — client returns goods, revenue/tax/AR reversed and stock added back at current warehouse avg cost.';

create table public.sales_return_lines (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.sales_returns(id) on delete cascade,
  invoice_line_id uuid not null references public.invoice_lines(id),
  item_id uuid references public.items(id),
  description text not null,
  qty numeric not null check (qty > 0),
  unit text,
  rate numeric not null default 0,
  tax_pct numeric not null default 0,
  amount numeric generated always as (round(qty * rate, 2)) stored,
  stock_value numeric not null default 0,
  sort_order integer not null default 0
);

comment on column public.sales_return_lines.stock_value is 'Inventory value posted for this line at creation time (qty * avg_cost as of the return) — persisted so cancellation reverses the exact same amount rather than recomputing against a since-changed avg cost.';

create index idx_sales_returns_invoice on public.sales_returns(invoice_id);
create index idx_sales_return_lines_return on public.sales_return_lines(return_id);

create trigger trg_audit after insert or delete or update on public.sales_returns for each row execute function fn_audit_row();
create trigger trg_updated_at before update on public.sales_returns for each row execute function fn_set_updated_at();

alter table public.sales_returns enable row level security;
create policy p_select on public.sales_returns for select using (true);
create policy p_insert on public.sales_returns for insert with check (public.is_owner() or public.has_role('accounts'));
create policy p_update on public.sales_returns for update using (public.is_owner() or public.has_role('accounts')) with check (public.is_owner() or public.has_role('accounts'));

alter table public.sales_return_lines enable row level security;
create policy p_select on public.sales_return_lines for select using (true);
create policy p_insert on public.sales_return_lines for insert with check (public.is_owner() or public.has_role('accounts'));

-- ---- Purchase Returns ----

create table public.purchase_returns (
  id uuid primary key default gen_random_uuid(),
  return_no text not null unique,
  supplier_bill_id uuid not null references public.supplier_bills(id),
  supplier_id uuid not null references public.parties(id),
  warehouse_id uuid not null references public.warehouses(id),
  return_date date not null default current_date,
  reason text not null,
  status text not null default 'Posted' check (status in ('Posted','Cancelled')),
  subtotal numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  cancel_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

comment on table public.purchase_returns is 'Debit note against a Posted Supplier Bill (stock-type purchases only) — goods returned to supplier, Trade Payables/Input Tax/Inventory reversed at the original billed rate.';

create table public.purchase_return_lines (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.purchase_returns(id) on delete cascade,
  supplier_bill_line_id uuid not null references public.supplier_bill_lines(id),
  item_id uuid references public.items(id),
  description text not null,
  qty numeric not null check (qty > 0),
  rate numeric not null default 0,
  tax_pct numeric not null default 0,
  amount numeric generated always as (round(qty * rate, 2)) stored,
  sort_order integer not null default 0
);

create index idx_purchase_returns_bill on public.purchase_returns(supplier_bill_id);
create index idx_purchase_return_lines_return on public.purchase_return_lines(return_id);

create trigger trg_audit after insert or delete or update on public.purchase_returns for each row execute function fn_audit_row();
create trigger trg_updated_at before update on public.purchase_returns for each row execute function fn_set_updated_at();

alter table public.purchase_returns enable row level security;
create policy p_select on public.purchase_returns for select using (true);
create policy p_insert on public.purchase_returns for insert with check (public.is_owner() or public.has_role('accounts') or public.has_role('store'));
create policy p_update on public.purchase_returns for update using (public.is_owner() or public.has_role('accounts') or public.has_role('store')) with check (public.is_owner() or public.has_role('accounts') or public.has_role('store'));

alter table public.purchase_return_lines enable row level security;
create policy p_select on public.purchase_return_lines for select using (true);
create policy p_insert on public.purchase_return_lines for insert with check (public.is_owner() or public.has_role('accounts') or public.has_role('store'));

-- ---- Widen the outstanding views to net Posted returns against their document ----
-- (returned_amount is appended as a NEW trailing column; every existing
-- column name stays at its original ordinal position, which is what
-- CREATE OR REPLACE VIEW requires — only outstanding_amount's underlying
-- expression changes, its name/position does not. Preserves the view's
-- security_invoker=true setting and existing grants.)

create or replace view public.invoice_outstanding as
select
  i.id as invoice_id,
  i.party_id,
  i.grand_total,
  coalesce(sum(pa.amount) filter (where p.status = 'Posted'), 0) as allocated_amount,
  i.grand_total
    - coalesce(sum(pa.amount) filter (where p.status = 'Posted'), 0)
    - coalesce(sr.returned_total, 0) as outstanding_amount,
  coalesce(sr.returned_total, 0) as returned_amount
from public.invoices i
left join public.payment_allocations pa on pa.invoice_id = i.id
left join public.payments p on p.id = pa.payment_id
left join (
  select invoice_id, sum(grand_total) as returned_total
  from public.sales_returns where status = 'Posted' group by invoice_id
) sr on sr.invoice_id = i.id
where i.status = 'Posted'
group by i.id, i.party_id, i.grand_total, sr.returned_total;

alter view public.invoice_outstanding set (security_invoker = true);
grant select on public.invoice_outstanding to authenticated;

create or replace view public.supplier_bill_outstanding as
select
  b.id as supplier_bill_id,
  b.supplier_id,
  b.grand_total,
  coalesce(sum(pa.amount) filter (where p.status = 'Posted'), 0) as allocated_amount,
  b.grand_total
    - coalesce(sum(pa.amount) filter (where p.status = 'Posted'), 0)
    - coalesce(pr.returned_total, 0) as outstanding_amount,
  coalesce(pr.returned_total, 0) as returned_amount
from public.supplier_bills b
left join public.payment_allocations pa on pa.supplier_bill_id = b.id
left join public.payments p on p.id = pa.payment_id
left join (
  select supplier_bill_id, sum(grand_total) as returned_total
  from public.purchase_returns where status = 'Posted' group by supplier_bill_id
) pr on pr.supplier_bill_id = b.id
where b.status = 'Posted'
group by b.id, b.supplier_id, b.grand_total, pr.returned_total;

alter view public.supplier_bill_outstanding set (security_invoker = true);
grant select on public.supplier_bill_outstanding to authenticated;

-- ---- Guard the original documents: can't cancel an Invoice/Bill that already has a Posted return against it ----

create or replace function public.fn_cancel_invoice(p_invoice_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_inv record;
  v_so record;
  v_line record;
  v_revenue_account text;
  v_lines jsonb := '[]'::jsonb;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Invoice cancel kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancel karne ki wajah likhna zaroori hai.';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if v_inv.id is null then
    raise exception 'Invoice nahi mili.';
  end if;
  if v_inv.status = 'Cancelled' then
    raise exception 'Yeh Invoice pehle se cancel hai.';
  end if;
  if exists (
    select 1 from public.payment_allocations pa join public.payments p on p.id = pa.payment_id
    where pa.invoice_id = p_invoice_id and p.status = 'Posted'
  ) then
    raise exception 'Is Invoice par payment allocate ho chuki hai — pehle payment cancel karen.';
  end if;
  if exists (select 1 from public.sales_returns where invoice_id = p_invoice_id and status = 'Posted') then
    raise exception 'Is Invoice par Sales Return ho chuka hai — pehle Sales Return cancel karen.';
  end if;

  select * into v_so from public.sales_orders where id = v_inv.sales_order_id for update;

  for v_line in select * from public.invoice_lines where invoice_id = p_invoice_id loop
    update public.sales_order_lines set invoiced_qty = invoiced_qty - v_line.qty where id = v_line.sales_order_line_id;
  end loop;

  v_revenue_account := case when v_so.business_line = 'fabrication' then '4010' else '4000' end;

  v_lines := v_lines || jsonb_build_object('account_code', v_revenue_account, 'party_id', null, 'debit', v_inv.subtotal, 'credit', 0, 'memo', 'Sales Revenue — reversed');
  if v_inv.tax_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '2400', 'party_id', null, 'debit', v_inv.tax_total, 'credit', 0, 'memo', 'Output Sales Tax (GST) — reversed');
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', '1200', 'party_id', v_so.party_id, 'debit', 0, 'credit', v_inv.grand_total, 'memo', 'Trade Receivables — reversed');

  perform public._fn_post_journal_entry_core(current_date, 'Invoice ' || v_inv.invoice_no || ' — cancelled', 'invoices', p_invoice_id, v_lines);

  update public.sales_orders
    set status = case when status = 'Invoiced' then 'Delivered' else status end
    where id = v_inv.sales_order_id and status not in ('Cancelled','Closed');

  update public.invoices set status = 'Cancelled', cancel_reason = p_reason where id = p_invoice_id;
end;
$function$;

create or replace function public.fn_cancel_supplier_bill(p_supplier_bill_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_bill record;
  v_lines jsonb := '[]'::jsonb;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Supplier Bill cancel kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancel karne ki wajah likhna zaroori hai.';
  end if;

  select * into v_bill from public.supplier_bills where id = p_supplier_bill_id for update;
  if v_bill.id is null then
    raise exception 'Supplier Bill nahi mili.';
  end if;
  if v_bill.status = 'Cancelled' then
    raise exception 'Yeh Bill pehle se cancel hai.';
  end if;
  if exists (
    select 1 from public.payment_allocations pa join public.payments p on p.id = pa.payment_id
    where pa.supplier_bill_id = p_supplier_bill_id and p.status = 'Posted'
  ) then
    raise exception 'Is Bill par payment allocate ho chuki hai — pehle payment cancel karen.';
  end if;
  if exists (select 1 from public.purchase_returns where supplier_bill_id = p_supplier_bill_id and status = 'Posted') then
    raise exception 'Is Bill par Purchase Return ho chuka hai — pehle Purchase Return cancel karen.';
  end if;

  v_lines := v_lines || jsonb_build_object('account_code', '2100', 'party_id', v_bill.supplier_id, 'debit', v_bill.grand_total, 'credit', 0, 'memo', 'Trade Payables — reversed');
  v_lines := v_lines || jsonb_build_object('account_code', '1330', 'party_id', v_bill.supplier_id, 'debit', 0, 'credit', v_bill.subtotal, 'memo', 'GRN Clearing — reversed');
  if v_bill.tax_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1400', 'party_id', null, 'debit', 0, 'credit', v_bill.tax_total, 'memo', 'Input Sales Tax — reversed');
  end if;

  perform public._fn_post_journal_entry_core(current_date, 'Supplier Bill ' || v_bill.bill_no || ' — cancelled', 'supplier_bills', p_supplier_bill_id, v_lines);

  update public.supplier_bills set status = 'Cancelled', cancel_reason = p_reason where id = p_supplier_bill_id;
end;
$function$;

-- ---- Sales Return functions ----

create or replace function public.fn_create_sales_return(
  p_invoice_id uuid, p_warehouse_id uuid, p_return_date date, p_reason text, p_lines jsonb
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_inv record;
  v_so record;
  v_il record;
  v_return_id uuid;
  v_return_no text;
  v_line jsonb;
  v_qty numeric;
  v_amount numeric;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_stock_value numeric;
  v_stock_value_total numeric := 0;
  v_avg_cost numeric;
  v_revenue_account text;
  v_cogs_account text;
  v_lines jsonb := '[]'::jsonb;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Sales Return bana sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Return ki wajah likhna zaroori hai.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Return mein kam az kam ek line honi chahiye.';
  end if;
  if p_warehouse_id is null then
    raise exception 'Warehouse zaroori hai (jahan returned stock jayega).';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if v_inv.id is null then
    raise exception 'Invoice nahi mili.';
  end if;
  if v_inv.status <> 'Posted' then
    raise exception 'Sirf Posted Invoice par Sales Return ban sakta hai.';
  end if;

  select * into v_so from public.sales_orders where id = v_inv.sales_order_id;

  select public.fn_get_next_number('SRN') into v_return_no;

  insert into public.sales_returns (return_no, invoice_id, sales_order_id, party_id, warehouse_id, return_date, reason, created_by)
  values (v_return_no, p_invoice_id, v_inv.sales_order_id, v_inv.party_id, p_warehouse_id, coalesce(p_return_date, current_date), p_reason, auth.uid())
  returning id into v_return_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_il from public.invoice_lines
      where id = (v_line->>'invoice_line_id')::uuid and invoice_id = p_invoice_id
      for update;
    if v_il.id is null then
      raise exception 'Invoice line nahi mili.';
    end if;

    v_qty := (v_line->>'qty')::numeric;
    if v_qty <= 0 then
      raise exception 'Return qty zero se zyada honi chahiye.';
    end if;
    if v_il.returned_qty + v_qty > v_il.qty then
      raise exception 'Return qty invoiced qty se zyada nahi ho sakti (%, max returnable: %).', v_il.description, v_il.qty - v_il.returned_qty;
    end if;

    v_amount := round(v_qty * v_il.rate, 2);
    v_stock_value := 0;

    if v_il.item_id is not null then
      select avg_cost into v_avg_cost from public.stock_ledger
        where item_id = v_il.item_id and warehouse_id = p_warehouse_id
        order by created_at desc, id desc limit 1;
      v_avg_cost := coalesce(v_avg_cost, 0);
      v_stock_value := round(v_qty * v_avg_cost, 2);
    end if;

    insert into public.sales_return_lines (return_id, invoice_line_id, item_id, description, qty, unit, rate, tax_pct, stock_value, sort_order)
    values (v_return_id, v_il.id, v_il.item_id, v_il.description, v_qty, v_il.unit, v_il.rate, v_il.tax_pct, v_stock_value, 0);

    update public.invoice_lines set returned_qty = returned_qty + v_qty where id = v_il.id;

    if v_il.item_id is not null then
      perform public._fn_post_stock_ledger(v_il.item_id, p_warehouse_id, 'SRN', v_qty, v_avg_cost, 'sales_returns', v_return_id, 'Sales Return ' || v_return_no);
    end if;

    v_subtotal := v_subtotal + v_amount;
    v_tax_total := v_tax_total + round(v_amount * v_il.tax_pct / 100, 2);
    v_stock_value_total := v_stock_value_total + v_stock_value;
  end loop;

  update public.sales_returns
    set subtotal = round(v_subtotal, 2), tax_total = round(v_tax_total, 2), grand_total = round(v_subtotal + v_tax_total, 2)
    where id = v_return_id;

  v_revenue_account := case when v_so.business_line = 'fabrication' then '4010' else '4000' end;
  v_cogs_account := case when v_so.business_line = 'fabrication' then '5010' else '5000' end;

  v_lines := v_lines || jsonb_build_object('account_code', v_revenue_account, 'party_id', null, 'debit', round(v_subtotal, 2), 'credit', 0, 'memo', 'Sales Return — revenue reversed');
  if v_tax_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '2400', 'party_id', null, 'debit', round(v_tax_total, 2), 'credit', 0, 'memo', 'Sales Return — output tax reversed');
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', '1200', 'party_id', v_inv.party_id, 'debit', 0, 'credit', round(v_subtotal + v_tax_total, 2), 'memo', 'Trade Receivables — reduced by return');
  if v_stock_value_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1310', 'party_id', null, 'debit', v_stock_value_total, 'credit', 0, 'memo', 'Raw Material Inventory — returned stock');
    v_lines := v_lines || jsonb_build_object('account_code', v_cogs_account, 'party_id', null, 'debit', 0, 'credit', v_stock_value_total, 'memo', 'Cost of Goods Sold — reversed');
  end if;

  perform public._fn_post_journal_entry_core(
    coalesce(p_return_date, current_date), 'Sales Return ' || v_return_no || ' (Invoice ' || v_inv.invoice_no || ')', 'sales_returns', v_return_id, v_lines
  );

  return v_return_id;
end;
$function$;

create or replace function public.fn_cancel_sales_return(p_return_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ret record;
  v_so record;
  v_line record;
  v_revenue_account text;
  v_cogs_account text;
  v_stock_value_total numeric := 0;
  v_lines jsonb := '[]'::jsonb;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Sales Return cancel kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancel karne ki wajah likhna zaroori hai.';
  end if;

  select * into v_ret from public.sales_returns where id = p_return_id for update;
  if v_ret.id is null then
    raise exception 'Sales Return nahi mili.';
  end if;
  if v_ret.status = 'Cancelled' then
    raise exception 'Yeh Sales Return pehle se cancel hai.';
  end if;

  select * into v_so from public.sales_orders where id = v_ret.sales_order_id;

  for v_line in select * from public.sales_return_lines where return_id = p_return_id loop
    update public.invoice_lines set returned_qty = returned_qty - v_line.qty where id = v_line.invoice_line_id;

    if v_line.item_id is not null and v_line.stock_value > 0 then
      -- Removes the stock that came back in; if it's since been re-issued
      -- elsewhere this correctly fails (stock cannot go negative), same
      -- guard every other stock reversal in this system relies on.
      perform public._fn_post_stock_ledger(v_line.item_id, v_ret.warehouse_id, 'SRN', -v_line.qty, 0, 'sales_returns', p_return_id, 'Sales Return ' || v_ret.return_no || ' — cancelled');
    end if;
    v_stock_value_total := v_stock_value_total + v_line.stock_value;
  end loop;

  v_revenue_account := case when v_so.business_line = 'fabrication' then '4010' else '4000' end;
  v_cogs_account := case when v_so.business_line = 'fabrication' then '5010' else '5000' end;

  v_lines := v_lines || jsonb_build_object('account_code', v_revenue_account, 'party_id', null, 'debit', 0, 'credit', v_ret.subtotal, 'memo', 'Sales Return cancelled — revenue re-reduced');
  if v_ret.tax_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '2400', 'party_id', null, 'debit', 0, 'credit', v_ret.tax_total, 'memo', 'Sales Return cancelled — output tax re-applied');
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', '1200', 'party_id', v_ret.party_id, 'debit', v_ret.grand_total, 'credit', 0, 'memo', 'Trade Receivables — restored');
  if v_stock_value_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1310', 'party_id', null, 'debit', 0, 'credit', v_stock_value_total, 'memo', 'Raw Material Inventory — removed');
    v_lines := v_lines || jsonb_build_object('account_code', v_cogs_account, 'party_id', null, 'debit', v_stock_value_total, 'credit', 0, 'memo', 'Cost of Goods Sold — restored');
  end if;

  perform public._fn_post_journal_entry_core(current_date, 'Sales Return ' || v_ret.return_no || ' — cancelled', 'sales_returns', p_return_id, v_lines);

  update public.sales_returns set status = 'Cancelled', cancel_reason = p_reason where id = p_return_id;
end;
$function$;

-- ---- Purchase Return functions ----

create or replace function public.fn_create_purchase_return(
  p_supplier_bill_id uuid, p_warehouse_id uuid, p_return_date date, p_reason text, p_lines jsonb
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_bill record;
  v_po record;
  v_bl record;
  v_return_id uuid;
  v_return_no text;
  v_line jsonb;
  v_qty numeric;
  v_amount numeric;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_lines jsonb := '[]'::jsonb;
begin
  if not (public.is_owner() or public.has_role('accounts') or public.has_role('store')) then
    raise exception 'Sirf Owner, Accounts ya Store Purchase Return bana sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Return ki wajah likhna zaroori hai.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Return mein kam az kam ek line honi chahiye.';
  end if;
  if p_warehouse_id is null then
    raise exception 'Warehouse zaroori hai (jahan se stock wapis jayega).';
  end if;

  select * into v_bill from public.supplier_bills where id = p_supplier_bill_id for update;
  if v_bill.id is null then
    raise exception 'Supplier Bill nahi mili.';
  end if;
  if v_bill.status <> 'Posted' then
    raise exception 'Sirf Posted Supplier Bill par Purchase Return ban sakta hai.';
  end if;

  select * into v_po from public.purchase_orders where id = v_bill.purchase_order_id;
  if v_po.id is null or v_po.purchase_type <> 'stock' then
    raise exception 'Purchase Return sirf stock-type purchases ke liye hai (direct/general GRN par receiving ke waqt hi AP book ho chuki thi — correction ke liye Journal Voucher istemal karen).';
  end if;

  select public.fn_get_next_number('PRN') into v_return_no;

  insert into public.purchase_returns (return_no, supplier_bill_id, supplier_id, warehouse_id, return_date, reason, created_by)
  values (v_return_no, p_supplier_bill_id, v_bill.supplier_id, p_warehouse_id, coalesce(p_return_date, current_date), p_reason, auth.uid())
  returning id into v_return_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_bl from public.supplier_bill_lines
      where id = (v_line->>'supplier_bill_line_id')::uuid and supplier_bill_id = p_supplier_bill_id
      for update;
    if v_bl.id is null then
      raise exception 'Bill line nahi mili.';
    end if;

    v_qty := (v_line->>'qty')::numeric;
    if v_qty <= 0 then
      raise exception 'Return qty zero se zyada honi chahiye.';
    end if;
    if v_bl.returned_qty + v_qty > v_bl.qty then
      raise exception 'Return qty billed qty se zyada nahi ho sakti (%, max returnable: %).', v_bl.description, v_bl.qty - v_bl.returned_qty;
    end if;

    v_amount := round(v_qty * v_bl.rate, 2);

    insert into public.purchase_return_lines (return_id, supplier_bill_line_id, item_id, description, qty, rate, tax_pct, sort_order)
    values (v_return_id, v_bl.id, v_bl.item_id, v_bl.description, v_qty, v_bl.rate, v_bl.tax_pct, 0);

    update public.supplier_bill_lines set returned_qty = returned_qty + v_qty where id = v_bl.id;

    if v_bl.item_id is not null then
      perform public._fn_post_stock_ledger(v_bl.item_id, p_warehouse_id, 'PRN', -v_qty, v_bl.rate, 'purchase_returns', v_return_id, 'Purchase Return ' || v_return_no);
    end if;

    v_subtotal := v_subtotal + v_amount;
    v_tax_total := v_tax_total + round(v_amount * v_bl.tax_pct / 100, 2);
  end loop;

  update public.purchase_returns
    set subtotal = round(v_subtotal, 2), tax_total = round(v_tax_total, 2), grand_total = round(v_subtotal + v_tax_total, 2)
    where id = v_return_id;

  v_lines := v_lines || jsonb_build_object('account_code', '2100', 'party_id', v_bill.supplier_id, 'debit', round(v_subtotal + v_tax_total, 2), 'credit', 0, 'memo', 'Trade Payables — reduced by return');
  if v_tax_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1400', 'party_id', null, 'debit', 0, 'credit', round(v_tax_total, 2), 'memo', 'Input Sales Tax — reversed');
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', '1310', 'party_id', null, 'debit', 0, 'credit', round(v_subtotal, 2), 'memo', 'Raw Material Inventory — returned to supplier');

  perform public._fn_post_journal_entry_core(
    coalesce(p_return_date, current_date), 'Purchase Return ' || v_return_no || ' (Bill ' || v_bill.bill_no || ')', 'purchase_returns', v_return_id, v_lines
  );

  return v_return_id;
end;
$function$;

create or replace function public.fn_cancel_purchase_return(p_return_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ret record;
  v_line record;
  v_lines jsonb := '[]'::jsonb;
begin
  if not (public.is_owner() or public.has_role('accounts') or public.has_role('store')) then
    raise exception 'Sirf Owner, Accounts ya Store Purchase Return cancel kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancel karne ki wajah likhna zaroori hai.';
  end if;

  select * into v_ret from public.purchase_returns where id = p_return_id for update;
  if v_ret.id is null then
    raise exception 'Purchase Return nahi mili.';
  end if;
  if v_ret.status = 'Cancelled' then
    raise exception 'Yeh Purchase Return pehle se cancel hai.';
  end if;

  for v_line in select * from public.purchase_return_lines where return_id = p_return_id loop
    update public.supplier_bill_lines set returned_qty = returned_qty - v_line.qty where id = v_line.supplier_bill_line_id;

    if v_line.item_id is not null then
      perform public._fn_post_stock_ledger(v_line.item_id, v_ret.warehouse_id, 'PRN', v_line.qty, v_line.rate, 'purchase_returns', p_return_id, 'Purchase Return ' || v_ret.return_no || ' — cancelled');
    end if;
  end loop;

  v_lines := v_lines || jsonb_build_object('account_code', '2100', 'party_id', v_ret.supplier_id, 'debit', 0, 'credit', v_ret.grand_total, 'memo', 'Trade Payables — restored');
  if v_ret.tax_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1400', 'party_id', null, 'debit', v_ret.tax_total, 'credit', 0, 'memo', 'Input Sales Tax — restored');
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', '1310', 'party_id', null, 'debit', v_ret.subtotal, 'credit', 0, 'memo', 'Raw Material Inventory — restored');

  perform public._fn_post_journal_entry_core(current_date, 'Purchase Return ' || v_ret.return_no || ' — cancelled', 'purchase_returns', p_return_id, v_lines);

  update public.purchase_returns set status = 'Cancelled', cancel_reason = p_reason where id = p_return_id;
end;
$function$;
