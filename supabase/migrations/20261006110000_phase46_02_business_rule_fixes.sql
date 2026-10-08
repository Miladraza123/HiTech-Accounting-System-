-- Phase 46.02 — Business-rule fixes (audit follow-up)
--
-- Companion to 20261006100000_phase46_01_security_hardening.sql, which owns
-- RLS / grants / is_owner / has_role / snapshot / journal-voucher changes.
-- This file touches none of those; it only fixes business logic. Every
-- function below is re-created from its LATEST definition (the file named in
-- each block), with signature, LANGUAGE, SECURITY, search_path unchanged, so
-- CREATE OR REPLACE keeps the existing grants. The only function whose
-- return type changes (fn_ar_aging / fn_ap_aging, new columns) is dropped and
-- re-created with its previous ACL copied back exactly.
--
--   1. fn_create_grn(_idempotent)       supplier must match the PO; journal party = PO supplier
--                                      (NO over-receipt cap — steel weight varies, owner's call)
--   2. stock_ledger.seq                 deterministic "latest row" (was created_at=now(), random uuid)
--   3. fn_amend_sales_order             line must belong to the SO; status / delivered / invoiced guards; status recompute
--   4. fn_cancel_sales_order            refuse once anything was delivered or invoiced
--   5. fn_create_delivery_challan(_idem) stock_qty derived on the server
--   6. fn_create_invoice(_idempotent)   rate >= 0, 0 <= tax_pct <= 100, column-precision rounding; CHECKs on line tables
--   7. fn_cancel_sales_return           reverse stock whenever the return posted stock
--   8. fn_owner_dashboard               payment_date filter; Asia/Karachi day for created_at counts
--   9. fn_ar_aging / fn_ap_aging        opening balance + unapplied (on-account) + net columns; Karachi day buckets
--  10. fn_adjust_party_balance         per-party advisory lock
--  11. parties                         CHECK credit_limit >= 0, credit_days >= 0 (NOT VALID)
--  12. fn_create_payment(_idem) / fn_allocate_payment  allocations rounded to 2 dp
--  13. fn_create_dispatch_go_ahead     only Issued DCs, no duplicate open go-ahead
--  14. fn_cancel_purchase_order        lock PO row before the GRN check

-- ===========================================================================
-- 1. fn_create_grn / fn_create_grn_idempotent — supplier must match the PO
-- ===========================================================================
-- NOTE: deliberately NO over-receipt cap. Steel weight varies, so receiving
-- more than ordered (and receiving on an already-Received PO) stays allowed,
-- exactly as before.

-- fn_create_grn
--
-- Latest definition: 20260913000400_phase21_02_translate_functions_batch_3.sql

CREATE OR REPLACE FUNCTION public.fn_create_grn(p_supplier_id uuid, p_purchase_order_id uuid, p_received_date date, p_warehouse_id uuid, p_remarks text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_po record;
  v_pol record;
  v_grn_id uuid;
  v_grn_no text;
  v_line jsonb;
  v_effective_warehouse uuid;
  v_stock_base_total numeric := 0;
  v_expense_base_total numeric := 0;
  v_expense_tax_total numeric := 0;
  v_all_received boolean;
  v_any_received boolean;
begin
  if not (public.is_owner() or public.has_role('store')) then
    raise exception 'Only Owner or Store can record receiving.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'GRN must have at least one line.';
  end if;

  select * into v_po from public.purchase_orders where id = p_purchase_order_id for update;
  if v_po.id is null then
    raise exception 'Purchase Order not found.';
  end if;
  if v_po.status in ('Cancelled','Closed') then
    raise exception 'Receiving cannot be recorded on this PO (status: %).', v_po.status;
  end if;

  -- Phase 46.02: the supplier on a GRN is the PO's supplier, full stop.
  -- p_supplier_id used to be trusted as-is and became the party on the
  -- GRN Clearing / Trade Payables journal line, so a wrong id silently
  -- booked the payable against another supplier. It is still accepted for
  -- signature compatibility, but only as a cross-check.
  if p_supplier_id is not null and p_supplier_id <> v_po.supplier_id then
    raise exception 'Supplier does not match the Purchase Order''s supplier — receiving must be recorded against the PO''s own supplier.';
  end if;

  v_effective_warehouse := coalesce(p_warehouse_id, v_po.warehouse_id);
  if v_po.purchase_type = 'stock' and v_effective_warehouse is null then
    raise exception 'Warehouse is required.';
  end if;

  select public.fn_get_next_number('GRN') into v_grn_no;

  insert into public.grns (grn_no, supplier_id, purchase_order_id, received_date, warehouse_id, remarks, created_by)
  values (v_grn_no, v_po.supplier_id, p_purchase_order_id, p_received_date, v_effective_warehouse, p_remarks, auth.uid())
  returning id into v_grn_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_pol from public.purchase_order_lines
      where id = (v_line->>'po_line_id')::uuid and purchase_order_id = p_purchase_order_id
      for update;
    if v_pol.id is null then
      raise exception 'PO line not found.';
    end if;

    insert into public.grn_lines
      (grn_id, po_line_id, ordered_qty, previously_received_qty, this_receipt_qty, rate, tax_pct, unit, item_id)
    values (
      v_grn_id, v_pol.id, v_pol.ordered_qty, v_pol.received_qty,
      (v_line->>'this_receipt_qty')::numeric, v_pol.rate, v_pol.tax_pct, v_pol.unit, v_pol.item_id
    );

    update public.purchase_order_lines
      set received_qty = received_qty + (v_line->>'this_receipt_qty')::numeric
      where id = v_pol.id;

    if v_po.purchase_type = 'stock' then
      if v_pol.item_id is null then
        raise exception 'Every line of a stock purchase must have an item.';
      end if;
      perform public._fn_post_stock_ledger(
        v_pol.item_id, v_effective_warehouse, 'GRN',
        (v_line->>'this_receipt_qty')::numeric, v_pol.rate, 'grns', v_grn_id, null
      );
      v_stock_base_total := v_stock_base_total + round((v_line->>'this_receipt_qty')::numeric * v_pol.rate, 2);
    else
      v_expense_base_total := v_expense_base_total + round((v_line->>'this_receipt_qty')::numeric * v_pol.rate, 2);
      v_expense_tax_total := v_expense_tax_total + round((v_line->>'this_receipt_qty')::numeric * v_pol.rate * v_pol.tax_pct / 100, 2);
    end if;
  end loop;

  select
    bool_and(received_qty >= ordered_qty),
    bool_or(received_qty > 0)
    into v_all_received, v_any_received
    from public.purchase_order_lines where purchase_order_id = p_purchase_order_id;

  update public.purchase_orders
    set status = case when v_all_received then 'Received' when v_any_received then 'PartiallyReceived' else status end
    where id = p_purchase_order_id;

  if v_stock_base_total > 0 then
    perform public._fn_post_journal_entry_core(
      p_received_date, 'GRN ' || v_grn_no || ' — stock received', 'grns', v_grn_id,
      jsonb_build_array(
        jsonb_build_object('account_code','1310','party_id',null,'debit',v_stock_base_total,'credit',0,'memo','Raw Material Inventory'),
        jsonb_build_object('account_code','1330','party_id',v_po.supplier_id,'debit',0,'credit',v_stock_base_total,'memo','GRN Clearing')
      )
    );
  end if;

  if v_expense_base_total > 0 then
    declare
      v_expense_account text := case when v_po.purchase_type = 'direct' then '5000' else '5800' end;
      v_lines jsonb := '[]'::jsonb;
    begin
      v_lines := v_lines || jsonb_build_object('account_code', v_expense_account, 'party_id', null, 'debit', v_expense_base_total, 'credit', 0, 'memo', 'Purchase');
      if v_expense_tax_total > 0 then
        v_lines := v_lines || jsonb_build_object('account_code','1400','party_id',null,'debit',v_expense_tax_total,'credit',0,'memo','Input Sales Tax');
      end if;
      v_lines := v_lines || jsonb_build_object('account_code','2100','party_id',v_po.supplier_id,'debit',0,'credit',v_expense_base_total + v_expense_tax_total,'memo','Trade Payables');

      perform public._fn_post_journal_entry_core(
        p_received_date, 'GRN ' || v_grn_no || ' — ' || v_po.purchase_type || ' purchase', 'grns', v_grn_id, v_lines
      );
    end;
  end if;

  return v_grn_id;
end;
$function$;

-- fn_create_grn_idempotent
--
-- Latest definition: 20260914040000_phase29_03_offline_first_procurement_create.sql

create or replace function public.fn_create_grn_idempotent(
  p_id uuid,
  p_supplier_id uuid,
  p_purchase_order_id uuid,
  p_received_date date,
  p_warehouse_id uuid,
  p_remarks text,
  p_lines jsonb -- [{po_line_id, this_receipt_qty}]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po record;
  v_pol record;
  v_existing uuid;
  v_grn_no text;
  v_line jsonb;
  v_effective_warehouse uuid;
  v_stock_base_total numeric := 0;
  v_expense_base_total numeric := 0;
  v_expense_tax_total numeric := 0;
  v_all_received boolean;
  v_any_received boolean;
begin
  if not (public.is_owner() or public.has_role('store')) then
    raise exception 'Only Owner or Store can receive goods.';
  end if;

  select id into v_existing from public.grns where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'A GRN needs at least one line.';
  end if;

  select * into v_po from public.purchase_orders where id = p_purchase_order_id for update;
  if v_po.id is null then
    raise exception 'Purchase Order not found.';
  end if;
  if v_po.status in ('Cancelled','Closed') then
    raise exception 'Cannot receive against a % Purchase Order.', v_po.status;
  end if;

  -- Phase 46.02: the supplier on a GRN is the PO's supplier, full stop.
  -- p_supplier_id used to be trusted as-is and became the party on the
  -- GRN Clearing / Trade Payables journal line, so a wrong id silently
  -- booked the payable against another supplier. It is still accepted for
  -- signature compatibility, but only as a cross-check.
  if p_supplier_id is not null and p_supplier_id <> v_po.supplier_id then
    raise exception 'Supplier does not match the Purchase Order''s supplier — receiving must be recorded against the PO''s own supplier.';
  end if;

  v_effective_warehouse := coalesce(p_warehouse_id, v_po.warehouse_id);
  if v_po.purchase_type = 'stock' and v_effective_warehouse is null then
    raise exception 'Warehouse is required.';
  end if;

  select public.fn_get_next_number('GRN') into v_grn_no;

  insert into public.grns (id, grn_no, supplier_id, purchase_order_id, received_date, warehouse_id, remarks, created_by)
  values (p_id, v_grn_no, v_po.supplier_id, p_purchase_order_id, p_received_date, v_effective_warehouse, p_remarks, auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.grns where id = p_id;
    return v_existing;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_pol from public.purchase_order_lines
      where id = (v_line->>'po_line_id')::uuid and purchase_order_id = p_purchase_order_id
      for update;
    if v_pol.id is null then
      raise exception 'PO line not found.';
    end if;

    insert into public.grn_lines
      (grn_id, po_line_id, ordered_qty, previously_received_qty, this_receipt_qty, rate, tax_pct, unit, item_id)
    values (
      p_id, v_pol.id, v_pol.ordered_qty, v_pol.received_qty,
      (v_line->>'this_receipt_qty')::numeric, v_pol.rate, v_pol.tax_pct, v_pol.unit, v_pol.item_id
    );

    update public.purchase_order_lines
      set received_qty = received_qty + (v_line->>'this_receipt_qty')::numeric
      where id = v_pol.id;

    if v_po.purchase_type = 'stock' then
      if v_pol.item_id is null then
        raise exception 'Every line of a stock purchase must have an Item.';
      end if;
      perform public._fn_post_stock_ledger(
        v_pol.item_id, v_effective_warehouse, 'GRN',
        (v_line->>'this_receipt_qty')::numeric, v_pol.rate, 'grns', p_id, null
      );
      v_stock_base_total := v_stock_base_total + round((v_line->>'this_receipt_qty')::numeric * v_pol.rate, 2);
    else
      v_expense_base_total := v_expense_base_total + round((v_line->>'this_receipt_qty')::numeric * v_pol.rate, 2);
      v_expense_tax_total := v_expense_tax_total + round((v_line->>'this_receipt_qty')::numeric * v_pol.rate * v_pol.tax_pct / 100, 2);
    end if;
  end loop;

  select
    bool_and(received_qty >= ordered_qty),
    bool_or(received_qty > 0)
    into v_all_received, v_any_received
    from public.purchase_order_lines where purchase_order_id = p_purchase_order_id;

  update public.purchase_orders
    set status = case when v_all_received then 'Received' when v_any_received then 'PartiallyReceived' else status end
    where id = p_purchase_order_id;

  if v_stock_base_total > 0 then
    perform public._fn_post_journal_entry_core(
      p_received_date, 'GRN ' || v_grn_no || ' — stock received', 'grns', p_id,
      jsonb_build_array(
        jsonb_build_object('account_code','1310','party_id',null,'debit',v_stock_base_total,'credit',0,'memo','Raw Material Inventory'),
        jsonb_build_object('account_code','1330','party_id',v_po.supplier_id,'debit',0,'credit',v_stock_base_total,'memo','GRN Clearing')
      )
    );
  end if;

  if v_expense_base_total > 0 then
    declare
      v_expense_account text := case when v_po.purchase_type = 'direct' then '5000' else '5800' end;
      v_lines jsonb := '[]'::jsonb;
    begin
      v_lines := v_lines || jsonb_build_object('account_code', v_expense_account, 'party_id', null, 'debit', v_expense_base_total, 'credit', 0, 'memo', 'Purchase');
      if v_expense_tax_total > 0 then
        v_lines := v_lines || jsonb_build_object('account_code','1400','party_id',null,'debit',v_expense_tax_total,'credit',0,'memo','Input Sales Tax');
      end if;
      v_lines := v_lines || jsonb_build_object('account_code','2100','party_id',v_po.supplier_id,'debit',0,'credit',v_expense_base_total + v_expense_tax_total,'memo','Trade Payables');

      perform public._fn_post_journal_entry_core(
        p_received_date, 'GRN ' || v_grn_no || ' — ' || v_po.purchase_type || ' purchase', 'grns', p_id, v_lines
      );
    end;
  end if;

  return p_id;
end;
$$;

-- ===========================================================================
-- 2. stock_ledger.seq — a strictly increasing posting sequence
-- ===========================================================================
-- "Latest row" for an item+warehouse was `order by created_at desc, id desc`.
-- created_at defaults to now() (= transaction start), and id is a random
-- uuid, so two postings of the same item+warehouse inside ONE transaction
-- (e.g. a GRN with two lines of the same item) tie on created_at and the
-- "latest" one is picked by uuid lottery: the second posting could read the
-- FIRST row's predecessor balance, and current_stock could show the
-- intermediate balance. seq is assigned at insert time (under the existing
-- per item+warehouse advisory lock in _fn_post_stock_ledger), so it orders
-- postings exactly as they happened.
alter table public.stock_ledger add column if not exists seq bigint;

-- Backfill. Rows are numbered in created_at order. Within a tie group
-- (same item, warehouse and created_at — the live data has one) the order is
-- rebuilt from the running_balance chain: starting from the balance before
-- the group, repeatedly take the row whose running_balance - qty equals the
-- current balance (when none fits, the row that starts a chain within the
-- group, then id), so every row's running_balance = previous
-- running_balance + qty again.
create temporary table _sl_tie_order (id uuid primary key, tie_pos int not null) on commit drop;

do $$
declare
  g record;
  r record;
  v_bal numeric;
  v_pos int;
begin
  for g in
    select item_id, warehouse_id, created_at
    from public.stock_ledger
    group by item_id, warehouse_id, created_at
    having count(*) > 1
    order by created_at
  loop
    select s.running_balance into v_bal
      from public.stock_ledger s
      left join _sl_tie_order t on t.id = s.id
      where s.item_id = g.item_id and s.warehouse_id = g.warehouse_id and s.created_at < g.created_at
      order by s.created_at desc, coalesce(t.tie_pos, 0) desc, s.id desc
      limit 1;
    v_bal := coalesce(v_bal, 0);
    v_pos := 0;
    loop
      select s.id, s.running_balance into r
        from public.stock_ledger s
        where s.item_id = g.item_id and s.warehouse_id = g.warehouse_id and s.created_at = g.created_at
          and not exists (select 1 from _sl_tie_order t where t.id = s.id)
        order by (s.running_balance - s.qty = v_bal) desc,
                 -- no exact fit: prefer the row that starts a chain inside the group
                 not exists (
                   select 1 from public.stock_ledger o
                   where o.item_id = s.item_id and o.warehouse_id = s.warehouse_id
                     and o.created_at = s.created_at and o.id <> s.id
                     and o.running_balance = s.running_balance - s.qty
                 ) desc,
                 s.id
        limit 1;
      exit when not found;
      v_pos := v_pos + 1;
      insert into _sl_tie_order (id, tie_pos) values (r.id, v_pos);
      v_bal := r.running_balance;
    end loop;
  end loop;
end;
$$;

update public.stock_ledger s
  set seq = o.rn
  from (
    select sl.id, row_number() over (order by sl.created_at, coalesce(t.tie_pos, 0), sl.id) as rn
    from public.stock_ledger sl
    left join _sl_tie_order t on t.id = sl.id
  ) o
  where o.id = s.id and s.seq is null;

create sequence if not exists public.stock_ledger_seq_seq owned by public.stock_ledger.seq;
select setval('public.stock_ledger_seq_seq', coalesce((select max(seq) from public.stock_ledger), 0) + 1, false);
alter table public.stock_ledger alter column seq set default nextval('public.stock_ledger_seq_seq');
alter table public.stock_ledger alter column seq set not null;
create unique index if not exists idx_stock_ledger_seq on public.stock_ledger(seq);
create index if not exists idx_stock_ledger_item_wh_seq on public.stock_ledger(item_id, warehouse_id, seq desc);

-- Owner backup/restore (fn_admin_restore_upsert) inserts stock_ledger rows
-- with `insert ... select * from jsonb_populate_recordset(...)`. A backup
-- taken before this migration has no seq key, which would insert an explicit
-- NULL (a column DEFAULT does not apply to an explicit NULL), so a trigger
-- fills it; a backup taken after it carries its own seq, and the sequence is
-- moved past it so new postings always sort after restored rows.
create or replace function public._fn_stock_ledger_assign_seq()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.seq is null then
    new.seq := nextval('public.stock_ledger_seq_seq');
  elsif new.seq > (select last_value from public.stock_ledger_seq_seq) then
    perform setval('public.stock_ledger_seq_seq', new.seq, true);
  end if;
  return new;
end;
$$;
revoke execute on function public._fn_stock_ledger_assign_seq() from public, anon, authenticated;

drop trigger if exists trg_stock_ledger_assign_seq on public.stock_ledger;
create trigger trg_stock_ledger_assign_seq
  before insert on public.stock_ledger
  for each row execute function public._fn_stock_ledger_assign_seq();

comment on column public.stock_ledger.seq is 'Posting order. The latest row for an item+warehouse is the one with the highest seq (created_at ties inside one transaction).';

-- _fn_post_stock_ledger
--
-- Latest definition: 20260911060133_phase3_03_stock_ledger_engine.sql
-- Previous balance now comes from the highest seq, not (created_at, id).
create or replace function public._fn_post_stock_ledger(
  p_item_id uuid,
  p_warehouse_id uuid,
  p_txn_type text,
  p_qty numeric,
  p_rate numeric,
  p_ref_table text,
  p_ref_id uuid,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_key bigint;
  v_prev_balance numeric := 0;
  v_prev_avg_cost numeric := 0;
  v_new_balance numeric;
  v_new_avg_cost numeric;
  v_id uuid;
begin
  v_lock_key := hashtextextended(p_item_id::text || ':' || p_warehouse_id::text, 0);
  perform pg_advisory_xact_lock(v_lock_key);

  select running_balance, avg_cost into v_prev_balance, v_prev_avg_cost
    from public.stock_ledger
    where item_id = p_item_id and warehouse_id = p_warehouse_id
    order by seq desc
    limit 1;

  v_prev_balance := coalesce(v_prev_balance, 0);
  v_prev_avg_cost := coalesce(v_prev_avg_cost, 0);
  v_new_balance := v_prev_balance + p_qty;

  if v_new_balance < 0 then
    raise exception 'Stock negative nahi ho sakta (available %, requested %).', v_prev_balance, -p_qty;
  end if;

  if p_qty > 0 then
    if v_new_balance = 0 then
      v_new_avg_cost := 0;
    else
      v_new_avg_cost := ((v_prev_balance * v_prev_avg_cost) + (p_qty * p_rate)) / v_new_balance;
    end if;
  else
    v_new_avg_cost := case when v_new_balance = 0 then 0 else v_prev_avg_cost end;
  end if;

  insert into public.stock_ledger
    (item_id, warehouse_id, txn_type, qty, rate, running_balance, avg_cost, ref_table, ref_id, notes, created_by)
  values
    (p_item_id, p_warehouse_id, p_txn_type, p_qty, p_rate, v_new_balance, round(v_new_avg_cost, 4), p_ref_table, p_ref_id, p_notes, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- current_stock: same columns, same security_invoker, latest row by seq.
-- (CREATE OR REPLACE VIEW re-applies reloptions from its WITH clause, so
-- security_invoker is restated here rather than relying on it surviving.)
create or replace view public.current_stock
with (security_invoker = true) as
select distinct on (item_id, warehouse_id)
  item_id, warehouse_id, running_balance as qty_on_hand, avg_cost,
  round(running_balance * avg_cost, 2) as stock_value, created_at as as_of
from public.stock_ledger
order by item_id, warehouse_id, seq desc;

-- Every other "latest avg_cost" lookup on stock_ledger: only change is
-- `order by created_at desc, id desc` -> `order by seq desc`.

-- fn_approve_stock_adjustment
--
-- Latest definition: 20260913000200_phase21_02_translate_functions_batch_1.sql
-- (seq ordering only)
CREATE OR REPLACE FUNCTION public.fn_approve_stock_adjustment(p_adjustment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_adj record;
  v_avg_cost numeric;
  v_value numeric;
begin
  if not public.is_owner() then
    raise exception 'Only Owner can approve adjustments.';
  end if;

  select * into v_adj from public.stock_adjustments where id = p_adjustment_id and status = 'Pending' for update;
  if v_adj.id is null then
    raise exception 'This adjustment is not Pending.';
  end if;

  select avg_cost into v_avg_cost
    from public.stock_ledger
    where item_id = v_adj.item_id and warehouse_id = v_adj.warehouse_id
    order by seq desc limit 1;
  v_avg_cost := coalesce(v_avg_cost, 0);

  perform public._fn_post_stock_ledger(
    v_adj.item_id, v_adj.warehouse_id, 'Adjustment', v_adj.qty_delta, v_avg_cost, 'stock_adjustments', p_adjustment_id, v_adj.reason
  );

  v_value := round(abs(v_adj.qty_delta) * v_avg_cost, 2);
  if v_value > 0 then
    if v_adj.qty_delta < 0 then
      -- Shortage: Dr Inventory Adjustment (expense) / Cr Raw Material Inventory
      perform public._fn_post_journal_entry_core(
        current_date, 'Stock adjustment (shortage) — ' || v_adj.reason, 'stock_adjustments', p_adjustment_id,
        jsonb_build_array(
          jsonb_build_object('account_code','5900','debit',v_value,'credit',0,'memo','Inventory shortage'),
          jsonb_build_object('account_code','1310','debit',0,'credit',v_value,'memo','Raw Material Inventory')
        )
      );
    else
      -- Excess: Dr Raw Material Inventory / Cr Inventory Adjustment (income)
      perform public._fn_post_journal_entry_core(
        current_date, 'Stock adjustment (excess) — ' || v_adj.reason, 'stock_adjustments', p_adjustment_id,
        jsonb_build_array(
          jsonb_build_object('account_code','1310','debit',v_value,'credit',0,'memo','Raw Material Inventory'),
          jsonb_build_object('account_code','5900','debit',0,'credit',v_value,'memo','Inventory excess found')
        )
      );
    end if;
  end if;

  update public.stock_adjustments
    set status = 'Approved', decided_by = auth.uid(), decided_at = now()
    where id = p_adjustment_id;
end;
$function$
;

-- fn_cancel_delivery_challan
--
-- Latest definition: 20260913000200_phase21_02_translate_functions_batch_1.sql
-- (seq ordering only)
CREATE OR REPLACE FUNCTION public.fn_cancel_delivery_challan(p_dc_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dc record;
  v_line record;
  v_avg_cost numeric;
  v_value numeric;
  v_reversal_qty numeric;
  v_stock_value_total numeric := 0;
  v_cogs_account text;
  v_business_line text;
  v_all_delivered boolean;
  v_any_delivered boolean;
begin
  if not public.is_owner() then
    raise exception 'Only Owner can cancel Delivery Challans.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason for cancelling is required.';
  end if;

  select * into v_dc from public.delivery_challans where id = p_dc_id for update;
  if v_dc.id is null then
    raise exception 'DC not found.';
  end if;
  if v_dc.status = 'Cancelled' then
    raise exception 'This DC is already cancelled.';
  end if;
  if exists (select 1 from public.invoices where sales_order_id = v_dc.sales_order_id and status = 'Posted') then
    raise exception 'An invoice has already been created for this Sales Order — the DC cannot be cancelled.';
  end if;

  select business_line into v_business_line from public.sales_orders where id = v_dc.sales_order_id;
  v_cogs_account := case when v_business_line = 'fabrication' then '5010' else '5000' end;

  for v_line in select * from public.delivery_challan_lines where dc_id = p_dc_id loop
    update public.sales_order_lines
      set delivered_qty = delivered_qty - v_line.delivered_qty
      where id = v_line.sales_order_line_id;

    if v_line.issue_from_stock then
      v_reversal_qty := coalesce(v_line.stock_qty, v_line.delivered_qty);
      select avg_cost into v_avg_cost from public.stock_ledger
        where item_id = v_line.item_id and warehouse_id = v_dc.warehouse_id
        order by seq desc limit 1;
      v_avg_cost := coalesce(v_avg_cost, 0);
      perform public._fn_post_stock_ledger(v_line.item_id, v_dc.warehouse_id, 'DC-Reversal', v_reversal_qty, v_avg_cost, 'delivery_challans', p_dc_id, 'Cancelled ' || v_dc.dc_no);
      v_value := round(v_reversal_qty * v_avg_cost, 2);
      v_stock_value_total := v_stock_value_total + v_value;
    end if;
  end loop;

  if v_stock_value_total > 0 then
    perform public._fn_post_journal_entry_core(
      current_date, 'Delivery Challan ' || v_dc.dc_no || ' — cancelled', 'delivery_challans', p_dc_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '1310', 'party_id', null, 'debit', v_stock_value_total, 'credit', 0, 'memo', 'Raw Material Inventory'),
        jsonb_build_object('account_code', v_cogs_account, 'party_id', null, 'debit', 0, 'credit', v_stock_value_total, 'memo', 'Cost of Goods Delivered — reversed')
      )
    );
  end if;

  select bool_and(delivered_qty >= ordered_qty), bool_or(delivered_qty > 0)
    into v_all_delivered, v_any_delivered
    from public.sales_order_lines where sales_order_id = v_dc.sales_order_id;

  update public.sales_orders
    set status = case when v_all_delivered then 'Delivered' when v_any_delivered then 'PartiallyDelivered' else 'Confirmed' end
    where id = v_dc.sales_order_id and status not in ('Cancelled','Closed');

  update public.delivery_challans set status = 'Cancelled', cancel_reason = p_reason where id = p_dc_id;
end;
$function$
;

-- fn_create_sales_return
--
-- Latest definition: 20260913000500_phase21_02_translate_functions_batch_4.sql
-- (seq ordering only)
CREATE OR REPLACE FUNCTION public.fn_create_sales_return(p_invoice_id uuid, p_warehouse_id uuid, p_return_date date, p_reason text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    raise exception 'Only Owner or Accounts can create a Sales Return.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason for the return is required.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Return must have at least one line.';
  end if;
  if p_warehouse_id is null then
    raise exception 'Warehouse is required (where the returned stock will go).';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if v_inv.id is null then
    raise exception 'Invoice not found.';
  end if;
  if v_inv.status <> 'Posted' then
    raise exception 'Sales Return can only be created for a Posted Invoice.';
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
      raise exception 'Invoice line not found.';
    end if;

    v_qty := (v_line->>'qty')::numeric;
    if v_qty <= 0 then
      raise exception 'Return quantity must be greater than zero.';
    end if;
    if v_il.returned_qty + v_qty > v_il.qty then
      raise exception 'Return quantity cannot exceed the invoiced quantity (%, max returnable: %).', v_il.description, v_il.qty - v_il.returned_qty;
    end if;

    v_amount := round(v_qty * v_il.rate, 2);
    v_stock_value := 0;

    if v_il.item_id is not null then
      select avg_cost into v_avg_cost from public.stock_ledger
        where item_id = v_il.item_id and warehouse_id = p_warehouse_id
        order by seq desc limit 1;
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

-- fn_create_sales_return_idempotent
--
-- Latest definition: 20260914070000_phase29_06_offline_first_returns_adjustments_create.sql
-- (seq ordering only)
create or replace function public.fn_create_sales_return_idempotent(
  p_id uuid,
  p_invoice_id uuid, p_warehouse_id uuid, p_return_date date, p_reason text, p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv record;
  v_so record;
  v_il record;
  v_existing uuid;
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
    raise exception 'Only Owner or Accounts can create a Sales Return.';
  end if;

  select id into v_existing from public.sales_returns where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'A Return needs at least one line.';
  end if;
  if p_warehouse_id is null then
    raise exception 'Warehouse is required (where the returned stock goes).';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if v_inv.id is null then
    raise exception 'Invoice not found.';
  end if;
  if v_inv.status <> 'Posted' then
    raise exception 'A Sales Return can only be created against a Posted Invoice.';
  end if;

  select * into v_so from public.sales_orders where id = v_inv.sales_order_id;

  select public.fn_get_next_number('SRN') into v_return_no;

  insert into public.sales_returns (id, return_no, invoice_id, sales_order_id, party_id, warehouse_id, return_date, reason, created_by)
  values (p_id, v_return_no, p_invoice_id, v_inv.sales_order_id, v_inv.party_id, p_warehouse_id, coalesce(p_return_date, current_date), p_reason, auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.sales_returns where id = p_id;
    return v_existing;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_il from public.invoice_lines
      where id = (v_line->>'invoice_line_id')::uuid and invoice_id = p_invoice_id
      for update;
    if v_il.id is null then
      raise exception 'Invoice line not found.';
    end if;

    v_qty := (v_line->>'qty')::numeric;
    if v_qty <= 0 then
      raise exception 'Return qty must be greater than zero.';
    end if;
    if v_il.returned_qty + v_qty > v_il.qty then
      raise exception 'Return qty cannot exceed invoiced qty (%, max returnable: %).', v_il.description, v_il.qty - v_il.returned_qty;
    end if;

    v_amount := round(v_qty * v_il.rate, 2);
    v_stock_value := 0;

    if v_il.item_id is not null then
      select avg_cost into v_avg_cost from public.stock_ledger
        where item_id = v_il.item_id and warehouse_id = p_warehouse_id
        order by seq desc limit 1;
      v_avg_cost := coalesce(v_avg_cost, 0);
      v_stock_value := round(v_qty * v_avg_cost, 2);
    end if;

    insert into public.sales_return_lines (return_id, invoice_line_id, item_id, description, qty, unit, rate, tax_pct, stock_value, sort_order)
    values (p_id, v_il.id, v_il.item_id, v_il.description, v_qty, v_il.unit, v_il.rate, v_il.tax_pct, v_stock_value, 0);

    update public.invoice_lines set returned_qty = returned_qty + v_qty where id = v_il.id;

    if v_il.item_id is not null then
      perform public._fn_post_stock_ledger(v_il.item_id, p_warehouse_id, 'SRN', v_qty, v_avg_cost, 'sales_returns', p_id, 'Sales Return ' || v_return_no);
    end if;

    v_subtotal := v_subtotal + v_amount;
    v_tax_total := v_tax_total + round(v_amount * v_il.tax_pct / 100, 2);
    v_stock_value_total := v_stock_value_total + v_stock_value;
  end loop;

  update public.sales_returns
    set subtotal = round(v_subtotal, 2), tax_total = round(v_tax_total, 2), grand_total = round(v_subtotal + v_tax_total, 2)
    where id = p_id;

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
    coalesce(p_return_date, current_date), 'Sales Return ' || v_return_no || ' (Invoice ' || v_inv.invoice_no || ')', 'sales_returns', p_id, v_lines
  );

  return p_id;
end;
$$;

-- fn_create_stock_transfer
--
-- Latest definition: 20260913000500_phase21_02_translate_functions_batch_4.sql
-- (seq ordering only)
CREATE OR REPLACE FUNCTION public.fn_create_stock_transfer(p_from_warehouse_id uuid, p_to_warehouse_id uuid, p_transfer_date date, p_remarks text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_transfer_id uuid;
  v_transfer_no text;
  v_line jsonb;
  v_item_id uuid;
  v_qty numeric;
  v_avg_cost numeric;
begin
  if not (public.is_owner() or public.has_role('store')) then
    raise exception 'Only Owner or Store can create a Stock Transfer.';
  end if;
  if p_from_warehouse_id = p_to_warehouse_id then
    raise exception 'From and To warehouse must be different.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Transfer must have at least one item.';
  end if;

  select public.fn_get_next_number('STN') into v_transfer_no;

  insert into public.stock_transfers (transfer_no, from_warehouse_id, to_warehouse_id, transfer_date, remarks, created_by)
  values (v_transfer_no, p_from_warehouse_id, p_to_warehouse_id, coalesce(p_transfer_date, current_date), p_remarks, auth.uid())
  returning id into v_transfer_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item_id := (v_line->>'item_id')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    if v_qty <= 0 then
      raise exception 'Transfer quantity must be greater than zero.';
    end if;

    select avg_cost into v_avg_cost from public.stock_ledger
      where item_id = v_item_id and warehouse_id = p_from_warehouse_id
      order by seq desc limit 1;
    v_avg_cost := coalesce(v_avg_cost, 0);

    insert into public.stock_transfer_lines (transfer_id, item_id, qty, rate, sort_order)
    values (v_transfer_id, v_item_id, v_qty, v_avg_cost, 0);

    -- Fails on insufficient stock at source (the same negative-balance
    -- guard every other stock movement in this system relies on).
    perform public._fn_post_stock_ledger(v_item_id, p_from_warehouse_id, 'STN', -v_qty, v_avg_cost, 'stock_transfers', v_transfer_id, 'Transfer ' || v_transfer_no || ' — out');
    perform public._fn_post_stock_ledger(v_item_id, p_to_warehouse_id, 'STN', v_qty, v_avg_cost, 'stock_transfers', v_transfer_id, 'Transfer ' || v_transfer_no || ' — in');
  end loop;

  return v_transfer_id;
end;
$function$;

-- fn_create_stock_transfer_idempotent
--
-- Latest definition: 20260914070000_phase29_06_offline_first_returns_adjustments_create.sql
-- (seq ordering only)
create or replace function public.fn_create_stock_transfer_idempotent(
  p_id uuid,
  p_from_warehouse_id uuid, p_to_warehouse_id uuid, p_transfer_date date, p_remarks text, p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_transfer_no text;
  v_line jsonb;
  v_item_id uuid;
  v_qty numeric;
  v_avg_cost numeric;
begin
  if not (public.is_owner() or public.has_role('store')) then
    raise exception 'Only Owner or Store can create a Stock Transfer.';
  end if;

  select id into v_existing from public.stock_transfers where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_from_warehouse_id = p_to_warehouse_id then
    raise exception 'From and To warehouse must be different.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'A Transfer needs at least one item.';
  end if;

  select public.fn_get_next_number('STN') into v_transfer_no;

  insert into public.stock_transfers (id, transfer_no, from_warehouse_id, to_warehouse_id, transfer_date, remarks, created_by)
  values (p_id, v_transfer_no, p_from_warehouse_id, p_to_warehouse_id, coalesce(p_transfer_date, current_date), p_remarks, auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.stock_transfers where id = p_id;
    return v_existing;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item_id := (v_line->>'item_id')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    if v_qty <= 0 then
      raise exception 'Transfer qty must be greater than zero.';
    end if;

    select avg_cost into v_avg_cost from public.stock_ledger
      where item_id = v_item_id and warehouse_id = p_from_warehouse_id
      order by seq desc limit 1;
    v_avg_cost := coalesce(v_avg_cost, 0);

    insert into public.stock_transfer_lines (transfer_id, item_id, qty, rate, sort_order)
    values (p_id, v_item_id, v_qty, v_avg_cost, 0);

    -- Fails on insufficient stock at source (same negative-balance guard
    -- every other stock movement relies on) — and since this whole
    -- function is one transaction, that failure rolls back the "in" leg
    -- too, never leaving stock removed from one warehouse without
    -- arriving at the other.
    perform public._fn_post_stock_ledger(v_item_id, p_from_warehouse_id, 'STN', -v_qty, v_avg_cost, 'stock_transfers', p_id, 'Transfer ' || v_transfer_no || ' — out');
    perform public._fn_post_stock_ledger(v_item_id, p_to_warehouse_id, 'STN', v_qty, v_avg_cost, 'stock_transfers', p_id, 'Transfer ' || v_transfer_no || ' — in');
  end loop;

  return p_id;
end;
$$;

-- fn_issue_job_material
--
-- Latest definition: 20260913000600_phase21_02_translate_functions_batch_5.sql
-- (seq ordering only)
CREATE OR REPLACE FUNCTION public.fn_issue_job_material(p_job_id uuid, p_item_id uuid, p_qty numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job record;
  v_avg_cost numeric;
  v_value numeric;
  v_to_consume numeric;
  v_res record;
  v_had_issue boolean;
begin
  if not (public.is_owner() or public.has_role('production') or public.has_role('store')) then
    raise exception 'You do not have permission to issue material.';
  end if;
  if p_qty <= 0 then
    raise exception 'Qty must be greater than zero.';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'Job not found.';
  end if;
  if v_job.status in ('ReadyForDispatch','Delivered','Cancelled') then
    raise exception 'Material cannot be issued at this stage (%).', v_job.status;
  end if;

  select (issued_qty > 0) into v_had_issue from public.job_material_requirements where job_id = p_job_id and item_id = p_item_id;

  select avg_cost into v_avg_cost from public.stock_ledger
    where item_id = p_item_id and warehouse_id = v_job.warehouse_id
    order by seq desc limit 1;
  v_avg_cost := coalesce(v_avg_cost, 0);

  perform public._fn_post_stock_ledger(p_item_id, v_job.warehouse_id, 'Issue', -p_qty, v_avg_cost, 'jobs', p_job_id, 'Issued to ' || v_job.job_no);

  -- Consume active reservations for this job+item, oldest first, up to p_qty
  v_to_consume := p_qty;
  for v_res in
    select * from public.stock_reservations
    where job_id = p_job_id and item_id = p_item_id and status = 'Active'
    order by created_at
    for update
  loop
    exit when v_to_consume <= 0;
    if v_res.reserved_qty <= v_to_consume then
      v_to_consume := v_to_consume - v_res.reserved_qty;
      update public.stock_reservations set status = 'Consumed' where id = v_res.id;
    else
      update public.stock_reservations set reserved_qty = reserved_qty - v_to_consume where id = v_res.id;
      v_to_consume := 0;
    end if;
  end loop;

  update public.job_material_requirements
    set issued_qty = issued_qty + p_qty,
        reserved_qty = greatest(0, reserved_qty - p_qty)
    where job_id = p_job_id and item_id = p_item_id;

  v_value := round(p_qty * v_avg_cost, 2);
  if v_value > 0 then
    insert into public.job_cost_ledger (job_id, cost_type, amount, qty, item_id, memo, ref_table, ref_id, created_by)
    values (p_job_id, 'material', v_value, p_qty, p_item_id, 'Material issued', 'stock_ledger', p_job_id, auth.uid());

    perform public._fn_post_journal_entry_core(
      current_date, 'Material issued to ' || v_job.job_no, 'jobs', p_job_id,
      jsonb_build_array(
        jsonb_build_object('account_code','1320','debit',v_value,'credit',0,'memo','Work-in-Progress'),
        jsonb_build_object('account_code','1310','debit',0,'credit',v_value,'memo','Raw Material Inventory')
      )
    );
  end if;

  if v_job.status = 'MaterialAvailable' and not coalesce(v_had_issue, false) then
    update public.jobs set status = 'FabricationStarted' where id = p_job_id;
  end if;
end;
$function$
;

-- fn_issue_job_material_idempotent
--
-- Latest definition: 20260914080000_phase29_07_offline_first_fabrication_create.sql
-- (seq ordering only)
create or replace function public.fn_issue_job_material_idempotent(
  p_id uuid,
  p_job_id uuid,
  p_item_id uuid,
  p_qty numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_job record;
  v_avg_cost numeric;
  v_value numeric;
  v_to_consume numeric;
  v_res record;
  v_had_issue boolean;
begin
  if not (public.is_owner() or public.has_role('production') or public.has_role('store')) then
    raise exception 'Only Owner, Production or Store can issue material.';
  end if;

  select id into v_existing from public.job_material_events where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_qty <= 0 then
    raise exception 'Qty must be greater than zero.';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'Job not found.';
  end if;
  if v_job.status in ('ReadyForDispatch', 'Delivered', 'Cancelled') then
    raise exception 'Material cannot be issued at this stage (%).', v_job.status;
  end if;
  if not exists (select 1 from public.job_material_requirements where job_id = p_job_id and item_id = p_item_id) then
    raise exception 'This item is not in the Job material requirement.';
  end if;

  insert into public.job_material_events (id, job_id, item_id, event_type, qty, created_by)
  values (p_id, p_job_id, p_item_id, 'issue', p_qty, auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.job_material_events where id = p_id;
    return v_existing;
  end if;

  select (issued_qty > 0) into v_had_issue from public.job_material_requirements where job_id = p_job_id and item_id = p_item_id;

  select avg_cost into v_avg_cost from public.stock_ledger
    where item_id = p_item_id and warehouse_id = v_job.warehouse_id
    order by seq desc limit 1;
  v_avg_cost := coalesce(v_avg_cost, 0);

  perform public._fn_post_stock_ledger(p_item_id, v_job.warehouse_id, 'Issue', -p_qty, v_avg_cost, 'jobs', p_job_id, 'Issued to ' || v_job.job_no);

  -- Consume active reservations for this job+item, oldest first, up to p_qty
  v_to_consume := p_qty;
  for v_res in
    select * from public.stock_reservations
    where job_id = p_job_id and item_id = p_item_id and status = 'Active'
    order by created_at
    for update
  loop
    exit when v_to_consume <= 0;
    if v_res.reserved_qty <= v_to_consume then
      v_to_consume := v_to_consume - v_res.reserved_qty;
      update public.stock_reservations set status = 'Consumed' where id = v_res.id;
    else
      update public.stock_reservations set reserved_qty = reserved_qty - v_to_consume where id = v_res.id;
      v_to_consume := 0;
    end if;
  end loop;

  update public.job_material_requirements
    set issued_qty = issued_qty + p_qty,
        reserved_qty = greatest(0, reserved_qty - p_qty)
    where job_id = p_job_id and item_id = p_item_id;

  v_value := round(p_qty * v_avg_cost, 2);
  if v_value > 0 then
    insert into public.job_cost_ledger (job_id, cost_type, amount, qty, item_id, memo, ref_table, ref_id, created_by)
    values (p_job_id, 'material', v_value, p_qty, p_item_id, 'Material issued', 'job_material_events', p_id, auth.uid());

    perform public._fn_post_journal_entry_core(
      current_date, 'Material issued to ' || v_job.job_no, 'job_material_events', p_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '1320', 'debit', v_value, 'credit', 0, 'memo', 'Work-in-Progress'),
        jsonb_build_object('account_code', '1310', 'debit', 0, 'credit', v_value, 'memo', 'Raw Material Inventory')
      )
    );
  end if;

  if v_job.status = 'MaterialAvailable' and not coalesce(v_had_issue, false) then
    update public.jobs set status = 'FabricationStarted' where id = p_job_id;
  end if;

  return p_id;
end;
$$;

-- fn_return_job_material
--
-- Latest definition: 20260913000700_phase21_02_translate_functions_batch_6.sql
-- (seq ordering only)
CREATE OR REPLACE FUNCTION public.fn_return_job_material(p_job_id uuid, p_item_id uuid, p_qty numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job record;
  v_avg_cost numeric;
  v_value numeric;
  v_issued numeric;
begin
  if not (public.is_owner() or public.has_role('production') or public.has_role('store')) then
    raise exception 'You do not have permission to return material.';
  end if;
  if p_qty <= 0 then
    raise exception 'Qty must be greater than zero.';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'Job not found.';
  end if;

  select issued_qty - returned_qty into v_issued from public.job_material_requirements where job_id = p_job_id and item_id = p_item_id;
  if coalesce(v_issued, 0) < p_qty then
    raise exception 'That much material was not issued (available to return: %).', coalesce(v_issued, 0);
  end if;

  select avg_cost into v_avg_cost from public.stock_ledger
    where item_id = p_item_id and warehouse_id = v_job.warehouse_id
    order by seq desc limit 1;
  v_avg_cost := coalesce(v_avg_cost, 0);

  perform public._fn_post_stock_ledger(p_item_id, v_job.warehouse_id, 'Return', p_qty, v_avg_cost, 'jobs', p_job_id, 'Returned from ' || v_job.job_no);

  update public.job_material_requirements
    set returned_qty = returned_qty + p_qty
    where job_id = p_job_id and item_id = p_item_id;

  v_value := round(p_qty * v_avg_cost, 2);
  if v_value > 0 then
    insert into public.job_cost_ledger (job_id, cost_type, amount, qty, item_id, memo, ref_table, ref_id, created_by)
    values (p_job_id, 'material', -v_value, -p_qty, p_item_id, 'Material returned', 'stock_ledger', p_job_id, auth.uid());

    perform public._fn_post_journal_entry_core(
      current_date, 'Material returned from ' || v_job.job_no, 'jobs', p_job_id,
      jsonb_build_array(
        jsonb_build_object('account_code','1310','debit',v_value,'credit',0,'memo','Raw Material Inventory'),
        jsonb_build_object('account_code','1320','debit',0,'credit',v_value,'memo','Work-in-Progress')
      )
    );
  end if;
end;
$function$
;

-- fn_return_job_material_idempotent
--
-- Latest definition: 20260914080000_phase29_07_offline_first_fabrication_create.sql
-- (seq ordering only)
create or replace function public.fn_return_job_material_idempotent(
  p_id uuid,
  p_job_id uuid,
  p_item_id uuid,
  p_qty numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_job record;
  v_avg_cost numeric;
  v_value numeric;
  v_issued numeric;
begin
  if not (public.is_owner() or public.has_role('production') or public.has_role('store')) then
    raise exception 'Only Owner, Production or Store can return material.';
  end if;

  select id into v_existing from public.job_material_events where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_qty <= 0 then
    raise exception 'Qty must be greater than zero.';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'Job not found.';
  end if;

  -- Re-validated against LIVE issued_qty/returned_qty at call time (the
  -- row is locked by the `select ... for update` above, on the parent
  -- Job — job_material_requirements itself has no independent row lock
  -- here, matching the original fn_return_job_material exactly), never a
  -- stale offline snapshot.
  select issued_qty - returned_qty into v_issued from public.job_material_requirements where job_id = p_job_id and item_id = p_item_id;
  if coalesce(v_issued, 0) < p_qty then
    raise exception 'That much material was never issued (available to return: %).', coalesce(v_issued, 0);
  end if;

  insert into public.job_material_events (id, job_id, item_id, event_type, qty, created_by)
  values (p_id, p_job_id, p_item_id, 'return', p_qty, auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.job_material_events where id = p_id;
    return v_existing;
  end if;

  select avg_cost into v_avg_cost from public.stock_ledger
    where item_id = p_item_id and warehouse_id = v_job.warehouse_id
    order by seq desc limit 1;
  v_avg_cost := coalesce(v_avg_cost, 0);

  perform public._fn_post_stock_ledger(p_item_id, v_job.warehouse_id, 'Return', p_qty, v_avg_cost, 'jobs', p_job_id, 'Returned from ' || v_job.job_no);

  update public.job_material_requirements
    set returned_qty = returned_qty + p_qty
    where job_id = p_job_id and item_id = p_item_id;

  v_value := round(p_qty * v_avg_cost, 2);
  if v_value > 0 then
    insert into public.job_cost_ledger (job_id, cost_type, amount, qty, item_id, memo, ref_table, ref_id, created_by)
    values (p_job_id, 'material', -v_value, -p_qty, p_item_id, 'Material returned', 'job_material_events', p_id, auth.uid());

    perform public._fn_post_journal_entry_core(
      current_date, 'Material returned from ' || v_job.job_no, 'job_material_events', p_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '1310', 'debit', v_value, 'credit', 0, 'memo', 'Raw Material Inventory'),
        jsonb_build_object('account_code', '1320', 'debit', 0, 'credit', v_value, 'memo', 'Work-in-Progress')
      )
    );
  end if;

  return p_id;
end;
$$;

-- ===========================================================================
-- 3. fn_amend_sales_order — scoped line updates + business guards
-- ===========================================================================
-- Latest definition: 20260913000800_phase21_03_translate_activity_timeline_notes.sql
-- Changes:
--   * an existing-line update is now `where id = .. and sales_order_id =
--     p_sales_order_id` (previously any SO's line could be rewritten through
--     another SO's amend) and an unknown id raises instead of silently doing
--     nothing;
--   * Cancelled / Closed SOs cannot be amended;
--   * ordered_qty cannot go below delivered_qty or invoiced_qty;
--   * rate cannot change on a line that has been invoiced; item and unit
--     cannot change once a line has been delivered or invoiced (stock and
--     the invoice were posted for the old ones);
--   * a line that was invoiced cannot be removed either (was: delivered only);
--   * status is recomputed afterwards with the same rules the DC and invoice
--     functions use (all invoiced -> Invoiced, all delivered -> Delivered,
--     some delivered -> PartiallyDelivered, otherwise unchanged), so raising
--     the qty of a Delivered/Invoiced order re-opens it.
CREATE OR REPLACE FUNCTION public.fn_amend_sales_order(p_sales_order_id uuid, p_reason text, p_client_po_number text, p_po_date date, p_delivery_schedule date, p_payment_terms text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_snapshot jsonb;
  v_next_rev int;
  v_revision_id uuid;
  v_line jsonb;
  v_kept_ids uuid[];
  v_idx int := 0;
  v_so record;
  v_old record;
  v_new_qty numeric;
  v_new_rate numeric;
  v_all_delivered boolean;
  v_any_delivered boolean;
  v_all_invoiced boolean;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can amend.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason for the amendment is required.';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'A Sales Order must keep at least one line.';
  end if;

  select * into v_so from public.sales_orders where id = p_sales_order_id for update;
  if v_so.id is null then
    raise exception 'Sales Order not found.';
  end if;
  if v_so.status in ('Cancelled','Closed') then
    raise exception 'This Sales Order cannot be amended (status: %).', v_so.status;
  end if;

  select jsonb_build_object(
    'client_po_number', so.client_po_number,
    'po_date', so.po_date,
    'delivery_schedule', so.delivery_schedule,
    'payment_terms', so.payment_terms,
    'lines', coalesce((select jsonb_agg(to_jsonb(l) order by l.sort_order) from public.sales_order_lines l where l.sales_order_id = p_sales_order_id), '[]'::jsonb)
  ) into v_snapshot
  from public.sales_orders so where so.id = p_sales_order_id;

  select coalesce(max(rev_no), 0) + 1 into v_next_rev
    from public.sales_order_revisions where sales_order_id = p_sales_order_id;

  insert into public.sales_order_revisions (sales_order_id, rev_no, reason, snapshot, created_by)
  values (p_sales_order_id, v_next_rev, p_reason, v_snapshot, auth.uid())
  returning id into v_revision_id;

  select array_agg((l->>'id')::uuid) filter (where l->>'id' is not null and l->>'id' <> '')
    into v_kept_ids
    from jsonb_array_elements(p_lines) l;

  if exists (
    select 1 from public.sales_order_lines
    where sales_order_id = p_sales_order_id and (delivered_qty > 0 or invoiced_qty > 0)
      and (v_kept_ids is null or not (id = any(v_kept_ids)))
  ) then
    raise exception 'A line that has already been delivered or invoiced cannot be removed — only qty/rate can be changed.';
  end if;

  delete from public.sales_order_lines
  where sales_order_id = p_sales_order_id
    and (v_kept_ids is null or not (id = any(v_kept_ids)));

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if (v_line ? 'id') and v_line->>'id' <> '' then
      select * into v_old from public.sales_order_lines
        where id = (v_line->>'id')::uuid and sales_order_id = p_sales_order_id
        for update;
      if v_old.id is null then
        raise exception 'Sales Order line not found on this Sales Order.';
      end if;

      v_new_qty := (v_line->>'ordered_qty')::numeric;
      v_new_rate := (v_line->>'rate')::numeric;
      if v_new_qty < v_old.delivered_qty or v_new_qty < v_old.invoiced_qty then
        raise exception 'Ordered qty for "%" cannot be less than what is already delivered (%) or invoiced (%).',
          v_old.description, v_old.delivered_qty, v_old.invoiced_qty;
      end if;
      if v_old.invoiced_qty > 0 and round(v_new_rate, 4) is distinct from v_old.rate then
        raise exception 'Rate for "%" cannot be changed — it has already been invoiced.', v_old.description;
      end if;
      if (v_old.delivered_qty > 0 or v_old.invoiced_qty > 0)
         and (nullif(v_line->>'item_id','')::uuid is distinct from v_old.item_id
              or nullif(v_line->>'unit','') is distinct from v_old.unit) then
        raise exception 'Item/unit for "%" cannot be changed — it has already been delivered or invoiced.', v_old.description;
      end if;

      update public.sales_order_lines set
        item_id = nullif(v_line->>'item_id','')::uuid,
        description = v_line->>'description',
        ordered_qty = v_new_qty,
        unit = nullif(v_line->>'unit',''),
        rate = v_new_rate,
        tax_pct = coalesce((v_line->>'tax_pct')::numeric, 0),
        sort_order = v_idx
      where id = v_old.id and sales_order_id = p_sales_order_id;
    else
      insert into public.sales_order_lines (sales_order_id, item_id, description, ordered_qty, unit, rate, tax_pct, sort_order)
      values (
        p_sales_order_id,
        nullif(v_line->>'item_id','')::uuid,
        v_line->>'description',
        (v_line->>'ordered_qty')::numeric,
        nullif(v_line->>'unit',''),
        (v_line->>'rate')::numeric,
        coalesce((v_line->>'tax_pct')::numeric, 0),
        v_idx
      );
    end if;
    v_idx := v_idx + 1;
  end loop;

  update public.sales_orders set
    client_po_number = p_client_po_number,
    po_date = p_po_date,
    delivery_schedule = p_delivery_schedule,
    payment_terms = p_payment_terms
  where id = p_sales_order_id;

  perform public._fn_recalc_so_totals(p_sales_order_id);

  -- Same status rules as fn_create_delivery_challan / fn_create_invoice.
  select bool_and(delivered_qty >= ordered_qty), bool_or(delivered_qty > 0), bool_and(invoiced_qty >= ordered_qty)
    into v_all_delivered, v_any_delivered, v_all_invoiced
    from public.sales_order_lines where sales_order_id = p_sales_order_id;

  update public.sales_orders
    set status = case
      when v_all_invoiced then 'Invoiced'
      when v_all_delivered then 'Delivered'
      when v_any_delivered then 'PartiallyDelivered'
      else status end
    where id = p_sales_order_id;

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  select 'queries', so.query_id, 'system',
         'Sales Order ' || so.so_no || ' was amended (Rev-' || v_next_rev || '). Reason: ' || p_reason, auth.uid()
  from public.sales_orders so where so.id = p_sales_order_id;

  return v_revision_id;
end;
$function$;

-- ===========================================================================
-- 4. fn_cancel_sales_order — refuse once goods moved or were billed
-- ===========================================================================
-- Latest definition: 20260913000800_phase21_03_translate_activity_timeline_notes.sql
-- Cancelling an SO did not touch its DCs, invoices or stock, so a delivered
-- or invoiced order could be "Cancelled" while its stock issue, COGS and
-- receivable stayed posted. Now refused while any non-cancelled Delivery
-- Challan or Invoice exists, or any line shows delivered/invoiced qty; the
-- user must cancel those documents first. (Reservations / jobs are not
-- released here because no existing cancel path does that — this only
-- blocks.) The SO row is locked first so a DC/invoice cannot slip in.
CREATE OR REPLACE FUNCTION public.fn_cancel_sales_order(p_sales_order_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_query_id uuid;
  v_so_no text;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can cancel.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason for cancelling is required.';
  end if;

  perform 1 from public.sales_orders where id = p_sales_order_id for update;

  if exists (select 1 from public.delivery_challans d
             where d.sales_order_id = p_sales_order_id and d.status <> 'Cancelled')
     or exists (select 1 from public.invoices i
                where i.sales_order_id = p_sales_order_id and i.status <> 'Cancelled')
     or exists (select 1 from public.sales_order_lines l
                where l.sales_order_id = p_sales_order_id and (l.delivered_qty > 0 or l.invoiced_qty > 0)) then
    raise exception 'This Sales Order has deliveries or invoices — cancel those first, then cancel the Sales Order.';
  end if;

  update public.sales_orders
    set status = 'Cancelled', cancel_reason = p_reason
    where id = p_sales_order_id and status not in ('Cancelled','Closed')
    returning query_id, so_no into v_query_id, v_so_no;

  if v_query_id is null then
    raise exception 'This Sales Order cannot be cancelled (it may already be Cancelled/Closed).';
  end if;

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', v_query_id, 'status_change', 'Sales Order ' || v_so_no || ' was cancelled. Reason: ' || p_reason, auth.uid());
end;
$function$;

-- ===========================================================================
-- 5. fn_create_delivery_challan(_idempotent) — server-computed stock_qty
-- ===========================================================================

-- fn_create_delivery_challan
--
-- Latest definition: 20260913000300_phase21_02_translate_functions_batch_2.sql
-- Also switched to seq ordering for the avg_cost lookup (fix 2).
CREATE OR REPLACE FUNCTION public.fn_create_delivery_challan(p_sales_order_id uuid, p_warehouse_id uuid, p_delivery_date date, p_vehicle_no text, p_driver_name text, p_remarks text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_so record;
  v_sol record;
  v_dc_id uuid;
  v_dc_no text;
  v_line jsonb;
  v_qty numeric;
  v_stock_qty numeric;
  v_base_unit text;
  v_factor numeric;
  v_issue boolean;
  v_avg_cost numeric;
  v_value numeric;
  v_stock_value_total numeric := 0;
  v_cogs_account text;
  v_all_delivered boolean;
  v_any_delivered boolean;
  v_job record;
begin
  if not (public.is_owner() or public.has_role('dispatch')) then
    raise exception 'Only Owner or Dispatch can create a Delivery Challan.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'DC must have at least one line.';
  end if;

  select * into v_so from public.sales_orders where id = p_sales_order_id for update;
  if v_so.id is null then
    raise exception 'Sales Order not found.';
  end if;
  if v_so.status in ('Cancelled','Closed') then
    raise exception 'Delivery is not possible for this Sales Order (status: %).', v_so.status;
  end if;

  select public.fn_get_next_number('DC') into v_dc_no;

  insert into public.delivery_challans
    (dc_no, sales_order_id, party_id, warehouse_id, delivery_date, vehicle_no, driver_name, remarks, created_by)
  values
    (v_dc_no, p_sales_order_id, v_so.party_id, p_warehouse_id, coalesce(p_delivery_date, current_date), p_vehicle_no, p_driver_name, p_remarks, auth.uid())
  returning id into v_dc_id;

  v_cogs_account := case when v_so.business_line = 'fabrication' then '5010' else '5000' end;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_sol from public.sales_order_lines
      where id = (v_line->>'sales_order_line_id')::uuid and sales_order_id = p_sales_order_id
      for update;
    if v_sol.id is null then
      raise exception 'Sales Order line not found.';
    end if;

    v_qty := (v_line->>'delivered_qty')::numeric;
    if v_qty <= 0 then
      raise exception 'Delivered qty must be greater than zero.';
    end if;
    if v_sol.delivered_qty + v_qty > v_sol.ordered_qty then
      raise exception 'Delivered qty cannot exceed ordered qty (%, pending: %).', v_sol.description, v_sol.ordered_qty - v_sol.delivered_qty;
    end if;

    v_issue := coalesce((v_line->>'issue_from_stock')::boolean, false);
    -- Phase 46.02: stock_qty is derived here, never taken from the client.
    -- Same rule as NewDeliveryChallanForm: line unit = item base unit (or
    -- no unit) -> delivered qty; otherwise delivered qty * the item's active
    -- item_alt_units factor, rounded to 3 dp. Any client-sent stock_qty is
    -- ignored (a stale offline-queued value must not move stock).
    v_stock_qty := null;
    if v_sol.item_id is not null then
      select i.base_unit into v_base_unit from public.items i where i.id = v_sol.item_id;
      if v_sol.unit is null or v_sol.unit = v_base_unit then
        v_stock_qty := v_qty;
      else
        select a.factor into v_factor from public.item_alt_units a
          where a.item_id = v_sol.item_id and a.unit = v_sol.unit and a.is_active;
        if v_factor is not null then
          v_stock_qty := round(v_qty * v_factor, 3);
        end if;
      end if;
    end if;
    if v_issue and v_sol.item_id is null then
      raise exception 'An item is required to issue from stock.';
    end if;
    if v_issue and v_stock_qty is null then
      raise exception 'No conversion factor is set from unit % to the item''s base unit % (%) — add it under Alternate Units in the Item Master, or do not issue from stock.', v_sol.unit, v_base_unit, v_sol.description;
    end if;
    v_stock_qty := coalesce(v_stock_qty, v_qty);
    if v_issue and v_stock_qty <= 0 then
      raise exception 'Stock qty must be greater than zero.';
    end if;

    insert into public.delivery_challan_lines
      (dc_id, sales_order_line_id, item_id, description, delivered_qty, unit, issue_from_stock, stock_qty, sort_order)
    values
      (v_dc_id, v_sol.id, v_sol.item_id, v_sol.description, v_qty, v_sol.unit, v_issue, v_stock_qty, 0);

    update public.sales_order_lines set delivered_qty = delivered_qty + v_qty where id = v_sol.id;

    if v_issue then
      if v_sol.item_id is null then
        raise exception 'An item is required to issue from stock.';
      end if;
      select avg_cost into v_avg_cost from public.stock_ledger
        where item_id = v_sol.item_id and warehouse_id = p_warehouse_id
        order by seq desc limit 1;
      v_avg_cost := coalesce(v_avg_cost, 0);
      perform public._fn_post_stock_ledger(v_sol.item_id, p_warehouse_id, 'DC', -v_stock_qty, v_avg_cost, 'delivery_challans', v_dc_id, 'Delivered via ' || v_dc_no);
      v_value := round(v_stock_qty * v_avg_cost, 2);
      v_stock_value_total := v_stock_value_total + v_value;
    end if;

    -- Advance any linked fabrication Job to Delivered once its SO line is fully delivered
    if v_sol.delivered_qty + v_qty >= v_sol.ordered_qty then
      for v_job in select * from public.jobs where sales_order_line_id = v_sol.id and status = 'ReadyForDispatch' loop
        update public.jobs set status = 'Delivered', progress_pct = 100 where id = v_job.id;
      end loop;
    end if;
  end loop;

  if v_stock_value_total > 0 then
    perform public._fn_post_journal_entry_core(
      coalesce(p_delivery_date, current_date), 'Delivery Challan ' || v_dc_no, 'delivery_challans', v_dc_id,
      jsonb_build_array(
        jsonb_build_object('account_code', v_cogs_account, 'party_id', null, 'debit', v_stock_value_total, 'credit', 0, 'memo', 'Cost of Goods Delivered'),
        jsonb_build_object('account_code', '1310', 'party_id', null, 'debit', 0, 'credit', v_stock_value_total, 'memo', 'Raw Material Inventory')
      )
    );
  end if;

  select bool_and(delivered_qty >= ordered_qty), bool_or(delivered_qty > 0)
    into v_all_delivered, v_any_delivered
    from public.sales_order_lines where sales_order_id = p_sales_order_id;

  update public.sales_orders
    set status = case when v_all_delivered then 'Delivered' when v_any_delivered then 'PartiallyDelivered' else status end
    where id = p_sales_order_id;

  return v_dc_id;
end;
$function$;

-- fn_create_delivery_challan_idempotent
--
-- Latest definition: 20260914050000_phase29_04_offline_first_fulfillment_billing_create.sql
-- Also switched to seq ordering for the avg_cost lookup (fix 2).
create or replace function public.fn_create_delivery_challan_idempotent(
  p_id uuid,
  p_sales_order_id uuid,
  p_warehouse_id uuid,
  p_delivery_date date,
  p_vehicle_no text,
  p_driver_name text,
  p_remarks text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so record;
  v_sol record;
  v_existing uuid;
  v_dc_no text;
  v_line jsonb;
  v_qty numeric;
  v_stock_qty numeric;
  v_base_unit text;
  v_factor numeric;
  v_issue boolean;
  v_avg_cost numeric;
  v_value numeric;
  v_stock_value_total numeric := 0;
  v_cogs_account text;
  v_all_delivered boolean;
  v_any_delivered boolean;
  v_job record;
begin
  if not (public.is_owner() or public.has_role('dispatch')) then
    raise exception 'Only Owner or Dispatch can create a Delivery Challan.';
  end if;

  select id into v_existing from public.delivery_challans where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'A Delivery Challan needs at least one line.';
  end if;

  select * into v_so from public.sales_orders where id = p_sales_order_id for update;
  if v_so.id is null then
    raise exception 'Sales Order not found.';
  end if;
  if v_so.status in ('Cancelled','Closed') then
    raise exception 'Cannot deliver against a % Sales Order.', v_so.status;
  end if;

  select public.fn_get_next_number('DC') into v_dc_no;

  insert into public.delivery_challans
    (id, dc_no, sales_order_id, party_id, warehouse_id, delivery_date, vehicle_no, driver_name, remarks, created_by)
  values
    (p_id, v_dc_no, p_sales_order_id, v_so.party_id, p_warehouse_id, coalesce(p_delivery_date, current_date), p_vehicle_no, p_driver_name, p_remarks, auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.delivery_challans where id = p_id;
    return v_existing;
  end if;

  v_cogs_account := case when v_so.business_line = 'fabrication' then '5010' else '5000' end;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_sol from public.sales_order_lines
      where id = (v_line->>'sales_order_line_id')::uuid and sales_order_id = p_sales_order_id
      for update;
    if v_sol.id is null then
      raise exception 'Sales Order line not found.';
    end if;

    v_qty := (v_line->>'delivered_qty')::numeric;
    if v_qty <= 0 then
      raise exception 'Delivered qty must be greater than zero.';
    end if;
    if v_sol.delivered_qty + v_qty > v_sol.ordered_qty then
      raise exception 'Delivered qty cannot exceed ordered qty (%, pending: %).', v_sol.description, v_sol.ordered_qty - v_sol.delivered_qty;
    end if;

    v_issue := coalesce((v_line->>'issue_from_stock')::boolean, false);
    -- Phase 46.02: stock_qty is derived here, never taken from the client.
    -- Same rule as NewDeliveryChallanForm: line unit = item base unit (or
    -- no unit) -> delivered qty; otherwise delivered qty * the item's active
    -- item_alt_units factor, rounded to 3 dp. Any client-sent stock_qty is
    -- ignored (a stale offline-queued value must not move stock).
    v_stock_qty := null;
    if v_sol.item_id is not null then
      select i.base_unit into v_base_unit from public.items i where i.id = v_sol.item_id;
      if v_sol.unit is null or v_sol.unit = v_base_unit then
        v_stock_qty := v_qty;
      else
        select a.factor into v_factor from public.item_alt_units a
          where a.item_id = v_sol.item_id and a.unit = v_sol.unit and a.is_active;
        if v_factor is not null then
          v_stock_qty := round(v_qty * v_factor, 3);
        end if;
      end if;
    end if;
    if v_issue and v_sol.item_id is null then
      raise exception 'An item is required to issue from stock.';
    end if;
    if v_issue and v_stock_qty is null then
      raise exception 'No conversion factor is set from unit % to the item''s base unit % (%) — add it under Alternate Units in the Item Master, or do not issue from stock.', v_sol.unit, v_base_unit, v_sol.description;
    end if;
    v_stock_qty := coalesce(v_stock_qty, v_qty);
    if v_issue and v_stock_qty <= 0 then
      raise exception 'Stock qty must be greater than zero.';
    end if;

    insert into public.delivery_challan_lines
      (dc_id, sales_order_line_id, item_id, description, delivered_qty, unit, issue_from_stock, stock_qty, sort_order)
    values
      (p_id, v_sol.id, v_sol.item_id, v_sol.description, v_qty, v_sol.unit, v_issue, v_stock_qty, 0);

    update public.sales_order_lines set delivered_qty = delivered_qty + v_qty where id = v_sol.id;

    if v_issue then
      if v_sol.item_id is null then
        raise exception 'An item is required to issue from stock.';
      end if;
      select avg_cost into v_avg_cost from public.stock_ledger
        where item_id = v_sol.item_id and warehouse_id = p_warehouse_id
        order by seq desc limit 1;
      v_avg_cost := coalesce(v_avg_cost, 0);
      perform public._fn_post_stock_ledger(v_sol.item_id, p_warehouse_id, 'DC', -v_stock_qty, v_avg_cost, 'delivery_challans', p_id, 'Delivered via ' || v_dc_no);
      v_value := round(v_stock_qty * v_avg_cost, 2);
      v_stock_value_total := v_stock_value_total + v_value;
    end if;

    if v_sol.delivered_qty + v_qty >= v_sol.ordered_qty then
      for v_job in select * from public.jobs where sales_order_line_id = v_sol.id and status = 'ReadyForDispatch' loop
        update public.jobs set status = 'Delivered', progress_pct = 100 where id = v_job.id;
      end loop;
    end if;
  end loop;

  if v_stock_value_total > 0 then
    perform public._fn_post_journal_entry_core(
      coalesce(p_delivery_date, current_date), 'Delivery Challan ' || v_dc_no, 'delivery_challans', p_id,
      jsonb_build_array(
        jsonb_build_object('account_code', v_cogs_account, 'party_id', null, 'debit', v_stock_value_total, 'credit', 0, 'memo', 'Cost of Goods Delivered'),
        jsonb_build_object('account_code', '1310', 'party_id', null, 'debit', 0, 'credit', v_stock_value_total, 'memo', 'Raw Material Inventory')
      )
    );
  end if;

  select bool_and(delivered_qty >= ordered_qty), bool_or(delivered_qty > 0)
    into v_all_delivered, v_any_delivered
    from public.sales_order_lines where sales_order_id = p_sales_order_id;

  update public.sales_orders
    set status = case when v_all_delivered then 'Delivered' when v_any_delivered then 'PartiallyDelivered' else status end
    where id = p_sales_order_id;

  return p_id;
end;
$$;

-- ===========================================================================
-- 6. fn_create_invoice(_idempotent) — bounded rate / tax_pct, column rounding
-- ===========================================================================

-- fn_create_invoice
--
-- Latest definition: 20260913000400_phase21_02_translate_functions_batch_3.sql

CREATE OR REPLACE FUNCTION public.fn_create_invoice(p_sales_order_id uuid, p_invoice_date date, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_so record;
  v_sol record;
  v_invoice_id uuid;
  v_invoice_no text;
  v_line jsonb;
  v_qty numeric;
  v_rate numeric;
  v_tax_pct numeric;
  v_amount numeric;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_all_invoiced boolean;
  v_revenue_account text;
  v_lines jsonb := '[]'::jsonb;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can create an Invoice.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Invoice must have at least one line.';
  end if;

  select * into v_so from public.sales_orders where id = p_sales_order_id for update;
  if v_so.id is null then
    raise exception 'Sales Order not found.';
  end if;
  if v_so.status = 'Cancelled' then
    raise exception 'An invoice cannot be created for a cancelled Sales Order.';
  end if;

  select public.fn_get_next_number('INV') into v_invoice_no;

  insert into public.invoices (invoice_no, sales_order_id, party_id, invoice_date, created_by)
  values (v_invoice_no, p_sales_order_id, v_so.party_id, coalesce(p_invoice_date, current_date), auth.uid())
  returning id into v_invoice_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_sol from public.sales_order_lines
      where id = (v_line->>'sales_order_line_id')::uuid and sales_order_id = p_sales_order_id
      for update;
    if v_sol.id is null then
      raise exception 'Sales Order line not found.';
    end if;

    -- Phase 46.02: round to invoice_lines' precision (qty 18,3) up front.
    v_qty := round((v_line->>'qty')::numeric, 3);
    if v_qty <= 0 then
      raise exception 'Qty must be greater than zero.';
    end if;
    if v_sol.invoiced_qty + v_qty > v_sol.delivered_qty then
      raise exception 'Invoice qty cannot exceed delivered qty (%, deliverable: %).', v_sol.description, v_sol.delivered_qty - v_sol.invoiced_qty;
    end if;

    -- Phase 46.02: rate / tax_pct are bounded, and rounded to the column
    -- precision (rate 18,2; tax_pct 5,2) BEFORE the amount is computed, so the
    -- header totals equal the sum of the stored (generated) line amounts.
    v_rate := round(coalesce((v_line->>'rate')::numeric, v_sol.rate), 2);
    v_tax_pct := round(coalesce((v_line->>'tax_pct')::numeric, v_sol.tax_pct), 2);
    if v_rate < 0 then
      raise exception 'Rate cannot be negative (%).', v_sol.description;
    end if;
    if v_tax_pct < 0 or v_tax_pct > 100 then
      raise exception 'Tax %% must be between 0 and 100 (%).', v_sol.description;
    end if;
    v_amount := round(v_qty * v_rate, 2);

    insert into public.invoice_lines
      (invoice_id, sales_order_line_id, item_id, description, qty, unit, rate, tax_pct, sort_order)
    values
      (v_invoice_id, v_sol.id, v_sol.item_id, v_sol.description, v_qty, v_sol.unit, v_rate, v_tax_pct, 0);

    update public.sales_order_lines set invoiced_qty = invoiced_qty + v_qty where id = v_sol.id;

    v_subtotal := v_subtotal + v_amount;
    v_tax_total := v_tax_total + round(v_amount * v_tax_pct / 100, 2);
  end loop;

  update public.invoices
    set subtotal = round(v_subtotal, 2), tax_total = round(v_tax_total, 2), grand_total = round(v_subtotal + v_tax_total, 2)
    where id = v_invoice_id;

  v_revenue_account := case when v_so.business_line = 'fabrication' then '4010' else '4000' end;

  v_lines := v_lines || jsonb_build_object('account_code', '1200', 'party_id', v_so.party_id, 'debit', round(v_subtotal + v_tax_total, 2), 'credit', 0, 'memo', 'Trade Receivables');
  v_lines := v_lines || jsonb_build_object('account_code', v_revenue_account, 'party_id', null, 'debit', 0, 'credit', round(v_subtotal, 2), 'memo', 'Sales Revenue');
  if v_tax_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '2400', 'party_id', null, 'debit', 0, 'credit', round(v_tax_total, 2), 'memo', 'Output Sales Tax (GST)');
  end if;

  perform public._fn_post_journal_entry_core(
    coalesce(p_invoice_date, current_date), 'Invoice ' || v_invoice_no, 'invoices', v_invoice_id, v_lines
  );

  select bool_and(invoiced_qty >= ordered_qty) into v_all_invoiced
    from public.sales_order_lines where sales_order_id = p_sales_order_id;

  update public.sales_orders
    set status = case when v_all_invoiced then 'Invoiced' else status end
    where id = p_sales_order_id;

  return v_invoice_id;
end;
$function$;

-- fn_create_invoice_idempotent
--
-- Latest definition: 20260914050000_phase29_04_offline_first_fulfillment_billing_create.sql

create or replace function public.fn_create_invoice_idempotent(
  p_id uuid,
  p_sales_order_id uuid,
  p_invoice_date date,
  p_lines jsonb -- [{sales_order_line_id, qty, rate, tax_pct}]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so record;
  v_sol record;
  v_existing uuid;
  v_invoice_no text;
  v_line jsonb;
  v_qty numeric;
  v_rate numeric;
  v_tax_pct numeric;
  v_amount numeric;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_all_invoiced boolean;
  v_revenue_account text;
  v_lines jsonb := '[]'::jsonb;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can create an Invoice.';
  end if;

  select id into v_existing from public.invoices where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'An Invoice needs at least one line.';
  end if;

  select * into v_so from public.sales_orders where id = p_sales_order_id for update;
  if v_so.id is null then
    raise exception 'Sales Order not found.';
  end if;
  if v_so.status = 'Cancelled' then
    raise exception 'Cannot invoice a Cancelled Sales Order.';
  end if;

  select public.fn_get_next_number('INV') into v_invoice_no;

  insert into public.invoices (id, invoice_no, sales_order_id, party_id, invoice_date, created_by)
  values (p_id, v_invoice_no, p_sales_order_id, v_so.party_id, coalesce(p_invoice_date, current_date), auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.invoices where id = p_id;
    return v_existing;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_sol from public.sales_order_lines
      where id = (v_line->>'sales_order_line_id')::uuid and sales_order_id = p_sales_order_id
      for update;
    if v_sol.id is null then
      raise exception 'Sales Order line not found.';
    end if;

    -- Phase 46.02: round to invoice_lines' precision (qty 18,3) up front.
    v_qty := round((v_line->>'qty')::numeric, 3);
    if v_qty <= 0 then
      raise exception 'Qty must be greater than zero.';
    end if;
    if v_sol.invoiced_qty + v_qty > v_sol.delivered_qty then
      raise exception 'Invoice qty cannot exceed delivered qty (%, invoiceable: %).', v_sol.description, v_sol.delivered_qty - v_sol.invoiced_qty;
    end if;

    -- Phase 46.02: rate / tax_pct are bounded, and rounded to the column
    -- precision (rate 18,2; tax_pct 5,2) BEFORE the amount is computed, so the
    -- header totals equal the sum of the stored (generated) line amounts.
    v_rate := round(coalesce((v_line->>'rate')::numeric, v_sol.rate), 2);
    v_tax_pct := round(coalesce((v_line->>'tax_pct')::numeric, v_sol.tax_pct), 2);
    if v_rate < 0 then
      raise exception 'Rate cannot be negative (%).', v_sol.description;
    end if;
    if v_tax_pct < 0 or v_tax_pct > 100 then
      raise exception 'Tax %% must be between 0 and 100 (%).', v_sol.description;
    end if;
    v_amount := round(v_qty * v_rate, 2);

    insert into public.invoice_lines
      (invoice_id, sales_order_line_id, item_id, description, qty, unit, rate, tax_pct, sort_order)
    values
      (p_id, v_sol.id, v_sol.item_id, v_sol.description, v_qty, v_sol.unit, v_rate, v_tax_pct, 0);

    update public.sales_order_lines set invoiced_qty = invoiced_qty + v_qty where id = v_sol.id;

    v_subtotal := v_subtotal + v_amount;
    v_tax_total := v_tax_total + round(v_amount * v_tax_pct / 100, 2);
  end loop;

  update public.invoices
    set subtotal = round(v_subtotal, 2), tax_total = round(v_tax_total, 2), grand_total = round(v_subtotal + v_tax_total, 2)
    where id = p_id;

  v_revenue_account := case when v_so.business_line = 'fabrication' then '4010' else '4000' end;

  v_lines := v_lines || jsonb_build_object('account_code', '1200', 'party_id', v_so.party_id, 'debit', round(v_subtotal + v_tax_total, 2), 'credit', 0, 'memo', 'Trade Receivables');
  v_lines := v_lines || jsonb_build_object('account_code', v_revenue_account, 'party_id', null, 'debit', 0, 'credit', round(v_subtotal, 2), 'memo', 'Sales Revenue');
  if v_tax_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '2400', 'party_id', null, 'debit', 0, 'credit', round(v_tax_total, 2), 'memo', 'Output Sales Tax (GST)');
  end if;

  perform public._fn_post_journal_entry_core(
    coalesce(p_invoice_date, current_date), 'Invoice ' || v_invoice_no, 'invoices', p_id, v_lines
  );

  select bool_and(invoiced_qty >= ordered_qty) into v_all_invoiced
    from public.sales_order_lines where sales_order_id = p_sales_order_id;

  update public.sales_orders
    set status = case when v_all_invoiced then 'Invoiced' else status end
    where id = p_sales_order_id;

  return p_id;
end;
$$;

-- Line-table CHECKs backing the bounds above. quotation_lines,
-- sales_order_lines and purchase_order_lines already have `rate >= 0` from
-- their CREATE TABLE, so they only gain the tax_pct range; invoice_lines and
-- supplier_bill_lines gain both. All are added NOT VALID: they are enforced
-- for every new/updated row immediately, but existing rows are not scanned
-- here (no live data was inspected for this migration). Once the data is
-- confirmed clean, run e.g.
--   alter table public.invoice_lines validate constraint invoice_lines_rate_nonneg_chk;
-- for each constraint below.
alter table public.invoice_lines drop constraint if exists invoice_lines_rate_nonneg_chk;
alter table public.invoice_lines add constraint invoice_lines_rate_nonneg_chk check (rate >= 0) not valid;
alter table public.invoice_lines drop constraint if exists invoice_lines_tax_pct_range_chk;
alter table public.invoice_lines add constraint invoice_lines_tax_pct_range_chk check (tax_pct between 0 and 100) not valid;

alter table public.supplier_bill_lines drop constraint if exists supplier_bill_lines_rate_nonneg_chk;
alter table public.supplier_bill_lines add constraint supplier_bill_lines_rate_nonneg_chk check (rate >= 0) not valid;
alter table public.supplier_bill_lines drop constraint if exists supplier_bill_lines_tax_pct_range_chk;
alter table public.supplier_bill_lines add constraint supplier_bill_lines_tax_pct_range_chk check (tax_pct between 0 and 100) not valid;

alter table public.purchase_order_lines drop constraint if exists purchase_order_lines_tax_pct_range_chk;
alter table public.purchase_order_lines add constraint purchase_order_lines_tax_pct_range_chk check (tax_pct between 0 and 100) not valid;

alter table public.quotation_lines drop constraint if exists quotation_lines_tax_pct_range_chk;
alter table public.quotation_lines add constraint quotation_lines_tax_pct_range_chk check (tax_pct between 0 and 100) not valid;

alter table public.sales_order_lines drop constraint if exists sales_order_lines_tax_pct_range_chk;
alter table public.sales_order_lines add constraint sales_order_lines_tax_pct_range_chk check (tax_pct between 0 and 100) not valid;

-- ===========================================================================
-- 7. fn_cancel_sales_return — reverse stock whenever stock was posted
-- ===========================================================================

-- fn_cancel_sales_return
--
-- Latest definition: 20260913000300_phase21_02_translate_functions_batch_2.sql

CREATE OR REPLACE FUNCTION public.fn_cancel_sales_return(p_return_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    raise exception 'Only Owner or Accounts can cancel a Sales Return.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason for cancelling is required.';
  end if;

  select * into v_ret from public.sales_returns where id = p_return_id for update;
  if v_ret.id is null then
    raise exception 'Sales Return not found.';
  end if;
  if v_ret.status = 'Cancelled' then
    raise exception 'This Sales Return is already cancelled.';
  end if;

  select * into v_so from public.sales_orders where id = v_ret.sales_order_id;

  for v_line in select * from public.sales_return_lines where return_id = p_return_id loop
    update public.invoice_lines set returned_qty = returned_qty - v_line.qty where id = v_line.invoice_line_id;

    -- Phase 46.02: reverse whenever the return actually put this item into
    -- stock (fn_create_sales_return posts an SRN for every line with an item,
    -- even at zero avg cost), not only when stock_value > 0 — otherwise a
    -- zero-cost item's stock stayed inflated after the cancel.
    if v_line.item_id is not null and exists (
      select 1 from public.stock_ledger sl
      where sl.ref_table = 'sales_returns' and sl.ref_id = p_return_id
        and sl.item_id = v_line.item_id and sl.warehouse_id = v_ret.warehouse_id
        and sl.qty > 0
    ) then
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

-- ===========================================================================
-- 8. fn_owner_dashboard — business-date filters
-- ===========================================================================
-- Latest definition: 20260916140018_phase33_03_scale_owner_dashboard_totals.sql
-- payments_received_total now filters on payments.payment_date (the date the
-- money moved, which can be back-dated) instead of the row's created_at in
-- UTC. The remaining created_at-based range counts (queries, quotations
-- sent, sales orders) bucket created_at by the business's local day
-- (Asia/Karachi) rather than the UTC day, so a document made at 02:00 PKT
-- lands on the right day. Everything else is byte-for-byte unchanged.
create or replace function public.fn_owner_dashboard(p_line text, p_from date, p_to date)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
with
so_health as materialized (
  select case
    when so.delivery_schedule is not null
         and floor(extract(epoch from ((so.delivery_schedule::timestamp at time zone 'UTC') - now())) / 86400) < 0 then 'Delayed'
    when so.delivery_schedule is not null
         and floor(extract(epoch from ((so.delivery_schedule::timestamp at time zone 'UTC') - now())) / 86400) <= 3 then 'AtRisk'
    when floor(extract(epoch from (now() - so.updated_at)) / 86400) > 10 then 'Stalled'
    else 'OnTrack' end as label
  from public.sales_orders so
  where (p_line = 'combined' or so.business_line = p_line)
    and so.status not in ('Delivered','Invoiced','Closed','Cancelled')
),
job_health as materialized (
  select case
    when j.required_delivery_date is not null
         and floor(extract(epoch from ((j.required_delivery_date::timestamp at time zone 'UTC') - now())) / 86400) < 0 then 'Delayed'
    when j.required_delivery_date is not null
         and floor(extract(epoch from ((j.required_delivery_date::timestamp at time zone 'UTC') - now())) / 86400) <= 3 then 'AtRisk'
    when floor(extract(epoch from (now() - j.updated_at)) / 86400) > 10 then 'Stalled'
    else 'OnTrack' end as label
  from public.jobs j
  where p_line <> 'material_supply'
    and j.status not in ('Delivered','Cancelled')
),
po_health as materialized (
  select case
    when po.expected_delivery is not null
         and floor(extract(epoch from ((po.expected_delivery::timestamp at time zone 'UTC') - now())) / 86400) < 0 then 'Delayed'
    when po.expected_delivery is not null
         and floor(extract(epoch from ((po.expected_delivery::timestamp at time zone 'UTC') - now())) / 86400) <= 3 then 'AtRisk'
    when floor(extract(epoch from (now() - po.updated_at)) / 86400) > 10 then 'Stalled'
    else 'OnTrack' end as label
  from public.purchase_orders po
  where po.status not in ('Received','Closed','Cancelled')
),
so_counts  as materialized (select label, count(*) as n from so_health  group by label),
job_counts as materialized (select label, count(*) as n from job_health group by label),
po_counts  as materialized (select label, count(*) as n from po_health  group by label),
all_counts as materialized (
  select label, sum(n) as n
  from (select * from so_counts union all select * from job_counts union all select * from po_counts) u
  group by label
),
quotes_sent as materialized (
  select q.id from public.quotations q
  where q.status <> 'Draft'
    and (q.created_at at time zone 'Asia/Karachi')::date between p_from and p_to
),
overdue as materialized (
  select o.invoice_id, p.id as party_id
  from public.invoice_outstanding o
  join public.invoices i on i.id = o.invoice_id
  join public.parties p on p.id = i.party_id
  where o.outstanding_amount > 0
    and floor(extract(epoch from (now() - (((i.invoice_date + coalesce(p.credit_days, 0))::date)::timestamp at time zone 'UTC'))) / 86400) > 0
),
pending_lines as materialized (
  select l.ordered_qty - l.delivered_qty as pending_deliver,
         l.delivered_qty - l.invoiced_qty as pending_invoice
  from public.sales_order_lines l
  join public.sales_orders so on so.id = l.sales_order_id
  where so.status not in ('Cancelled','Closed')
    and (p_line = 'combined' or so.business_line = p_line)
)
select jsonb_build_object(
  'queries_in_range', (select count(*) from public.queries q
                       where (q.created_at at time zone 'Asia/Karachi')::date between p_from and p_to),
  'quotations_sent_in_range', (select count(*) from quotes_sent),
  'sales_orders_in_range', (select count(*) from public.sales_orders s
                            where (p_line = 'combined' or s.business_line = p_line)
                              and (s.created_at at time zone 'Asia/Karachi')::date between p_from and p_to),
  'converted_in_range', (select count(*) from public.sales_orders s
                         where s.status <> 'Cancelled' and s.quotation_id in (select id from quotes_sent)),
  'payments_received_total', (select coalesce(sum(pay.amount), 0) from public.payments pay
                              where pay.direction = 'receipt' and pay.status = 'Posted'
                                and pay.payment_date between p_from and p_to),
  'pending_deliver_count', (select count(*) from pending_lines where pending_deliver > 0.001),
  'pending_invoice_count', (select count(*) from pending_lines where pending_invoice > 0.001),
  'receivables_total', (select coalesce(sum(o.outstanding_amount), 0)
                        from public.invoice_outstanding o
                        left join public.invoices i on i.id = o.invoice_id
                        left join public.sales_orders so on so.id = i.sales_order_id
                        where o.outstanding_amount > 0
                          and (p_line = 'combined' or so.business_line = p_line)),
  'payables_total', (select coalesce(sum(outstanding_amount), 0) from public.supplier_bill_outstanding),
  'cash_balance', (select coalesce(max(balance), 0) from public.cash_in_hand_balance),
  'bank_total', (select coalesce(sum(balance), 0) from public.bank_account_balances where is_active),
  'petty_total', (select coalesce(sum(balance), 0) from public.petty_cash_fund_balances where is_active),
  'stock_value_total', (select coalesce(sum(stock_value), 0) from public.current_stock),
  'overdue_invoice_count', (select count(*) from overdue),
  'accounts_pending_count', (select count(distinct party_id) from overdue),
  'credit_warning_count', (select count(*) from public.parties p
                           left join public.party_ar_summary s on s.party_id = p.id
                           where p.party_type in ('client','both') and p.credit_limit > 0
                             and coalesce(s.total_outstanding, 0) / p.credit_limit >= 0.9),
  'quotation_followup_count', (select count(*) from public.quotations q
                               join public.queries qr on qr.id = q.query_id
                               where q.status = 'Sent'
                                 and qr.next_followup_at is not null
                                 and qr.next_followup_at <= current_date),
  'shortage_item_count', (select count(distinct r.item_id)
                          from public.job_material_requirements r
                          join public.jobs j on j.id = r.job_id
                          where p_line <> 'material_supply'
                            and r.source = 'stock' and j.status = 'MaterialPending'
                            and r.required_qty - r.reserved_qty - r.issued_qty > 0.001),
  'on_track_count', (select coalesce(sum(n), 0) from all_counts where label = 'OnTrack'),
  'attention_count', (select coalesce(sum(n), 0) from all_counts where label in ('AtRisk','Stalled')),
  'delayed_count', (select coalesce(sum(n), 0) from all_counts where label = 'Delayed'),
  'job_delayed_count', (select coalesce(sum(n), 0) from job_counts where label = 'Delayed'),
  'delivery_overdue_count', (select coalesce(sum(n), 0) from so_counts where label = 'Delayed'),
  'material_pending_job_count', (select count(*) from public.jobs j
                                 where p_line <> 'material_supply' and j.status = 'MaterialPending'),
  'client_acceptance_pending_count', (select count(*) from public.delivery_challans d
                                      where d.status = 'Issued' and d.acceptance_status = 'Pending'),
  'open_po_count', (select coalesce(sum(n), 0) from po_counts),
  'fabrication_pending_count', (select coalesce(sum(n), 0) from job_counts where label in ('AtRisk','Stalled','Delayed')),
  'client_pending_count', (select count(*) from public.quotations q where q.status = 'Sent'),
  'active_material_supply_so_count', (select count(*) from public.sales_orders s
                                      where s.business_line = 'material_supply'
                                        and s.status not in ('Delivered','Invoiced','Closed','Cancelled')),
  'active_fabrication_job_count', (select count(*) from public.jobs j
                                   where j.status not in ('Delivered','Cancelled'))
);
$function$;

-- ===========================================================================
-- 9. fn_ar_aging / fn_ap_aging — opening balance, unapplied credit, net
-- ===========================================================================
-- Latest definitions: 20260916135912_phase33_01_scale_report_functions.sql
-- The aging only bucketed open invoices / supplier bills, so it disagreed
-- with the 1200 / 2100 control accounts by (a) payments sitting
-- unallocated on account and (b) opening balances posted as bare journal
-- entries (createPartyAction / fn_adjust_party_balance post with
-- source_table 'parties', the Import Wizard with 'import_batches'). Three
-- columns are appended (existing columns keep their names, order and
-- meaning):
--   opening_balance  signed total of the party's control-account lines
--                    from non-document journal entries — opening balances
--                    and their adjustments (source 'parties' /
--                    'import_batches'; since 46.01 the party/import opening
--                    JVs are recorded as 'manual') plus manual JVs on the
--                    party. + = party owes us (AR) / we owe the party (AP)
--   unapplied        sum of payments.unallocated_amount of Posted payments
--                    in that direction (receipts for AR, payments for AP)
--   net              total + opening_balance - unapplied
-- Parties with only an opening balance or only unapplied credit are now
-- listed too (all buckets 0). Day buckets use the business's local date
-- (Asia/Karachi) instead of a UTC-midnight timestamp difference.
-- Still LANGUAGE sql, STABLE, SECURITY INVOKER, search_path public, so the
-- caller's RLS on payments / journal_lines applies as before.
--
-- The return type changes, so the functions are dropped and re-created; their
-- ACLs are captured first and copied back exactly afterwards (this keeps
-- whatever 46.01 or earlier migrations granted / revoked).
create temporary table _phase46_02_aging_acl on commit drop as
select p.proname::text as fname, coalesce(p.proacl, acldefault('f', p.proowner)) as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('fn_ar_aging', 'fn_ap_aging') and p.pronargs = 0;

drop function if exists public.fn_ar_aging();
drop function if exists public.fn_ap_aging();

create function public.fn_ar_aging()
returns table(party_id uuid, name text, bucket_current numeric, bucket_1_30 numeric,
              bucket_31_60 numeric, bucket_61_90 numeric, bucket_90_plus numeric, total numeric,
              opening_balance numeric, unapplied numeric, net numeric)
language sql
stable
set search_path to 'public'
as $function$
  with aged as materialized (
    select o.party_id,
           o.outstanding_amount,
           ((now() at time zone 'Asia/Karachi')::date - (i.invoice_date + coalesce(p.credit_days, 0)))::bigint as days_late
    from public.invoice_outstanding o
    join public.invoices i on i.id = o.invoice_id
    join public.parties p on p.id = o.party_id
    where o.outstanding_amount > 0
  ),
  buckets as (
    select party_id,
           coalesce(sum(outstanding_amount) filter (where days_late <= 0), 0) as b_current,
           coalesce(sum(outstanding_amount) filter (where days_late between 1 and 30), 0) as b_1_30,
           coalesce(sum(outstanding_amount) filter (where days_late between 31 and 60), 0) as b_31_60,
           coalesce(sum(outstanding_amount) filter (where days_late between 61 and 90), 0) as b_61_90,
           coalesce(sum(outstanding_amount) filter (where days_late > 90), 0) as b_90_plus,
           coalesce(sum(outstanding_amount), 0) as b_total
    from aged
    group by party_id
  ),
  opening as (
    select jl.party_id, sum(jl.debit - jl.credit) as amt
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join public.chart_of_accounts coa on coa.id = jl.account_id
    where coa.code = '1200' and jl.party_id is not null
      and (je.source_table is null or je.source_table in ('parties', 'import_batches', 'manual'))
    group by jl.party_id
  ),
  unapplied as (
    select pay.party_id, sum(pay.unallocated_amount) as amt
    from public.payments pay
    where pay.direction = 'receipt' and pay.status = 'Posted' and pay.unallocated_amount > 0
    group by pay.party_id
  ),
  ids as (
    select party_id from buckets
    union select party_id from opening where amt <> 0
    union select party_id from unapplied
  )
  select ids.party_id,
         p.legal_name,
         coalesce(b.b_current, 0),
         coalesce(b.b_1_30, 0),
         coalesce(b.b_31_60, 0),
         coalesce(b.b_61_90, 0),
         coalesce(b.b_90_plus, 0),
         coalesce(b.b_total, 0),
         coalesce(op.amt, 0),
         coalesce(u.amt, 0),
         coalesce(b.b_total, 0) + coalesce(op.amt, 0) - coalesce(u.amt, 0)
  from ids
  join public.parties p on p.id = ids.party_id
  left join buckets b on b.party_id = ids.party_id
  left join opening op on op.party_id = ids.party_id
  left join unapplied u on u.party_id = ids.party_id
  order by coalesce(b.b_total, 0) desc, coalesce(b.b_total, 0) + coalesce(op.amt, 0) - coalesce(u.amt, 0) desc;
$function$;

create function public.fn_ap_aging()
returns table(party_id uuid, name text, bucket_current numeric, bucket_1_30 numeric,
              bucket_31_60 numeric, bucket_61_90 numeric, bucket_90_plus numeric, total numeric,
              opening_balance numeric, unapplied numeric, net numeric)
language sql
stable
set search_path to 'public'
as $function$
  with aged as materialized (
    select o.supplier_id as party_id,
           o.outstanding_amount,
           ((now() at time zone 'Asia/Karachi')::date - (b.bill_date + coalesce(p.credit_days, 0)))::bigint as days_late
    from public.supplier_bill_outstanding o
    join public.supplier_bills b on b.id = o.supplier_bill_id
    join public.parties p on p.id = o.supplier_id
    where o.outstanding_amount > 0
  ),
  buckets as (
    select party_id,
           coalesce(sum(outstanding_amount) filter (where days_late <= 0), 0) as b_current,
           coalesce(sum(outstanding_amount) filter (where days_late between 1 and 30), 0) as b_1_30,
           coalesce(sum(outstanding_amount) filter (where days_late between 31 and 60), 0) as b_31_60,
           coalesce(sum(outstanding_amount) filter (where days_late between 61 and 90), 0) as b_61_90,
           coalesce(sum(outstanding_amount) filter (where days_late > 90), 0) as b_90_plus,
           coalesce(sum(outstanding_amount), 0) as b_total
    from aged
    group by party_id
  ),
  opening as (
    select jl.party_id, sum(jl.credit - jl.debit) as amt
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join public.chart_of_accounts coa on coa.id = jl.account_id
    where coa.code = '2100' and jl.party_id is not null
      and (je.source_table is null or je.source_table in ('parties', 'import_batches', 'manual'))
    group by jl.party_id
  ),
  unapplied as (
    select pay.party_id, sum(pay.unallocated_amount) as amt
    from public.payments pay
    where pay.direction = 'payment' and pay.status = 'Posted' and pay.unallocated_amount > 0
    group by pay.party_id
  ),
  ids as (
    select party_id from buckets
    union select party_id from opening where amt <> 0
    union select party_id from unapplied
  )
  select ids.party_id,
         p.legal_name,
         coalesce(b.b_current, 0),
         coalesce(b.b_1_30, 0),
         coalesce(b.b_31_60, 0),
         coalesce(b.b_61_90, 0),
         coalesce(b.b_90_plus, 0),
         coalesce(b.b_total, 0),
         coalesce(op.amt, 0),
         coalesce(u.amt, 0),
         coalesce(b.b_total, 0) + coalesce(op.amt, 0) - coalesce(u.amt, 0)
  from ids
  join public.parties p on p.id = ids.party_id
  left join buckets b on b.party_id = ids.party_id
  left join opening op on op.party_id = ids.party_id
  left join unapplied u on u.party_id = ids.party_id
  order by coalesce(b.b_total, 0) desc, coalesce(b.b_total, 0) + coalesce(op.amt, 0) - coalesce(u.amt, 0) desc;
$function$;

-- Copy the captured ACLs back: first strip whatever the re-create granted
-- (PUBLIC + any default privileges), then re-grant exactly the old entries.
do $$
declare
  r record;
  a record;
  v_owner oid;
begin
  for r in select * from _phase46_02_aging_acl loop
    select p.proowner into v_owner from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = r.fname and p.pronargs = 0;
    for a in
      select distinct (aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))).grantee as grantee
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = r.fname and p.pronargs = 0
    loop
      if a.grantee <> v_owner then
        execute format('revoke all on function public.%I() from %s', r.fname,
          case when a.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end);
      end if;
    end loop;
    for a in select (aclexplode(r.acl)).* loop
      if a.grantee <> v_owner and a.privilege_type = 'EXECUTE' then
        execute format('grant execute on function public.%I() to %s%s', r.fname,
          case when a.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end,
          case when a.is_grantable then ' with grant option' else '' end);
      end if;
    end loop;
  end loop;
end;
$$;

-- ===========================================================================
-- 10. fn_adjust_party_balance — per-party lock before reading the balance
-- ===========================================================================

-- fn_adjust_party_balance
--
-- Latest definition: 20261003110000_phase39_02_opening_balance_and_adjust.sql

create or replace function public.fn_adjust_party_balance(
  p_party_id uuid,
  p_direction text,
  p_new_balance numeric,
  p_narration text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current numeric;
  v_delta numeric;
  v_entry_id uuid;
  v_narration text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts may adjust an opening balance.';
  end if;
  if p_direction not in ('receivable', 'payable') then
    raise exception 'Invalid direction.';
  end if;
  if p_new_balance < 0 then
    raise exception 'Balance cannot be negative.';
  end if;

  -- Phase 46.02: serialise adjustments per party. Without this two
  -- concurrent adjustments both read the same v_current and both post the
  -- full delta, overshooting the requested balance.
  perform pg_advisory_xact_lock(hashtext('party_balance:' || p_party_id::text));

  select coalesce(sum(case when p_direction = 'receivable' then jl.debit - jl.credit else jl.credit - jl.debit end), 0)
    into v_current
  from public.journal_lines jl
  join public.chart_of_accounts coa on coa.id = jl.account_id
  where coa.code = (case when p_direction = 'receivable' then '1200' else '2100' end)
    and jl.party_id = p_party_id;

  v_delta := round(p_new_balance - v_current, 2);
  if v_delta = 0 then
    raise exception 'New balance is the same as the current balance — nothing to adjust.';
  end if;

  v_narration := coalesce(p_narration, 'Opening balance adjustment');

  if p_direction = 'receivable' then
    v_entry_id := public._fn_post_journal_entry_core(
      current_date, v_narration, 'parties', p_party_id,
      case when v_delta > 0 then
        jsonb_build_array(
          jsonb_build_object('account_code', '1200', 'party_id', p_party_id, 'debit', v_delta, 'credit', 0, 'memo', v_narration),
          jsonb_build_object('account_code', '1900', 'party_id', null, 'debit', 0, 'credit', v_delta, 'memo', v_narration)
        )
      else
        jsonb_build_array(
          jsonb_build_object('account_code', '1900', 'party_id', null, 'debit', abs(v_delta), 'credit', 0, 'memo', v_narration),
          jsonb_build_object('account_code', '1200', 'party_id', p_party_id, 'debit', 0, 'credit', abs(v_delta), 'memo', v_narration)
        )
      end
    );
  else
    v_entry_id := public._fn_post_journal_entry_core(
      current_date, v_narration, 'parties', p_party_id,
      case when v_delta > 0 then
        jsonb_build_array(
          jsonb_build_object('account_code', '1900', 'party_id', null, 'debit', v_delta, 'credit', 0, 'memo', v_narration),
          jsonb_build_object('account_code', '2100', 'party_id', p_party_id, 'debit', 0, 'credit', v_delta, 'memo', v_narration)
        )
      else
        jsonb_build_array(
          jsonb_build_object('account_code', '2100', 'party_id', p_party_id, 'debit', abs(v_delta), 'credit', 0, 'memo', v_narration),
          jsonb_build_object('account_code', '1900', 'party_id', null, 'debit', 0, 'credit', abs(v_delta), 'memo', v_narration)
        )
      end
    );
  end if;

  return v_entry_id;
end;
$$;

-- ===========================================================================
-- 11. parties — non-negative credit limit / credit days
-- ===========================================================================
-- NOT VALID because the live DB holds one TEST party with negative values:
-- new and updated rows are checked from now on (an UPDATE of that TEST row
-- will have to fix those two values too). After cleaning it up:
--   alter table public.parties validate constraint parties_credit_limit_nonneg_chk;
--   alter table public.parties validate constraint parties_credit_days_nonneg_chk;
alter table public.parties drop constraint if exists parties_credit_limit_nonneg_chk;
alter table public.parties add constraint parties_credit_limit_nonneg_chk check (credit_limit >= 0) not valid;
alter table public.parties drop constraint if exists parties_credit_days_nonneg_chk;
alter table public.parties add constraint parties_credit_days_nonneg_chk check (credit_days >= 0) not valid;

-- ===========================================================================
-- 12. fn_create_payment(_idempotent) / fn_allocate_payment — 2 dp allocations
-- ===========================================================================
-- Every read of an allocation amount is rounded to 2 dp (payment_allocations
-- .amount is numeric(18,2)), so the sum checked against the payment /
-- unallocated amount is the sum of what is actually stored. Previously
-- 0.333 + 0.333 + 0.334 passed the check but stored 0.33+0.33+0.33, leaving
-- unallocated_amount off by a paisa.

-- fn_create_payment
--
-- Latest definition: 20260913000400_phase21_02_translate_functions_batch_3.sql

CREATE OR REPLACE FUNCTION public.fn_create_payment(p_party_id uuid, p_direction text, p_payment_date date, p_method text, p_reference_no text, p_amount numeric, p_notes text, p_allocations jsonb, p_bank_account_id uuid DEFAULT NULL::uuid, p_petty_cash_fund_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_party record;
  v_payment_id uuid;
  v_payment_no text;
  v_line jsonb;
  v_alloc_total numeric := 0;
  v_outstanding numeric;
  v_cash_account_code text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can record a Payment.';
  end if;
  if p_direction not in ('receipt','payment') then
    raise exception 'Direction is invalid.';
  end if;
  if p_amount <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;

  select * into v_party from public.parties where id = p_party_id;
  if v_party.id is null then
    raise exception 'Party not found.';
  end if;
  if p_direction = 'receipt' and v_party.party_type not in ('client','both') then
    raise exception 'This party is not a client.';
  end if;
  if p_direction = 'payment' and v_party.party_type not in ('supplier','both') then
    raise exception 'This party is not a supplier.';
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_alloc_total := v_alloc_total + round((v_line->>'amount')::numeric, 2);
  end loop;
  if v_alloc_total > p_amount then
    raise exception 'Allocation total cannot exceed the payment amount.';
  end if;

  v_cash_account_code := case
    when p_petty_cash_fund_id is not null then '1060'
    when p_bank_account_id is not null then '1100'
    when p_method ilike 'cash' then '1050'
    else '1050'
  end;

  select public.fn_get_next_number('PAY') into v_payment_no;

  insert into public.payments
    (payment_no, party_id, direction, payment_date, method, reference_no, amount, unallocated_amount, notes,
     bank_account_id, petty_cash_fund_id, created_by)
  values
    (v_payment_no, p_party_id, p_direction, coalesce(p_payment_date, current_date), p_method, p_reference_no,
     p_amount, p_amount - v_alloc_total, p_notes, p_bank_account_id, p_petty_cash_fund_id, auth.uid())
  returning id into v_payment_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    if p_direction = 'receipt' then
      perform pg_advisory_xact_lock(hashtextextended('invoice:' || (v_line->>'invoice_id'), 0));

      select outstanding_amount into v_outstanding from public.invoice_outstanding
        where invoice_id = (v_line->>'invoice_id')::uuid and party_id = p_party_id;
      if v_outstanding is null then
        raise exception 'Invoice does not belong to this party or was not found.';
      end if;
      if round((v_line->>'amount')::numeric, 2) > v_outstanding then
        raise exception 'Allocation exceeds the outstanding amount (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, invoice_id, amount)
      values (v_payment_id, (v_line->>'invoice_id')::uuid, round((v_line->>'amount')::numeric, 2));
    else
      perform pg_advisory_xact_lock(hashtextextended('supplier_bill:' || (v_line->>'supplier_bill_id'), 0));

      select outstanding_amount into v_outstanding from public.supplier_bill_outstanding
        where supplier_bill_id = (v_line->>'supplier_bill_id')::uuid and supplier_id = p_party_id;
      if v_outstanding is null then
        raise exception 'Supplier Bill does not belong to this party or was not found.';
      end if;
      if round((v_line->>'amount')::numeric, 2) > v_outstanding then
        raise exception 'Allocation exceeds the outstanding amount (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, supplier_bill_id, amount)
      values (v_payment_id, (v_line->>'supplier_bill_id')::uuid, round((v_line->>'amount')::numeric, 2));
    end if;
  end loop;

  if p_direction = 'receipt' then
    perform public._fn_post_journal_entry_core(
      coalesce(p_payment_date, current_date), 'Receipt ' || v_payment_no, 'payments', v_payment_id,
      jsonb_build_array(
        jsonb_build_object('account_code', v_cash_account_code, 'bank_account_id', p_bank_account_id, 'petty_cash_fund_id', p_petty_cash_fund_id, 'debit', p_amount, 'credit', 0, 'memo', 'Cash/Bank received'),
        jsonb_build_object('account_code', '1200', 'party_id', p_party_id, 'debit', 0, 'credit', p_amount, 'memo', 'Trade Receivables')
      )
    );
  else
    perform public._fn_post_journal_entry_core(
      coalesce(p_payment_date, current_date), 'Payment ' || v_payment_no, 'payments', v_payment_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '2100', 'party_id', p_party_id, 'debit', p_amount, 'credit', 0, 'memo', 'Trade Payables'),
        jsonb_build_object('account_code', v_cash_account_code, 'bank_account_id', p_bank_account_id, 'petty_cash_fund_id', p_petty_cash_fund_id, 'debit', 0, 'credit', p_amount, 'memo', 'Cash/Bank paid')
      )
    );
  end if;

  return v_payment_id;
end;
$function$;

-- fn_create_payment_idempotent
--
-- Latest definition: 20260914060000_phase29_05_offline_first_payments_cash_bank_create.sql

create or replace function public.fn_create_payment_idempotent(
  p_id uuid,
  p_party_id uuid, p_direction text, p_payment_date date, p_method text, p_reference_no text,
  p_amount numeric, p_notes text, p_allocations jsonb,
  p_bank_account_id uuid default null, p_petty_cash_fund_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party record;
  v_existing uuid;
  v_payment_no text;
  v_line jsonb;
  v_alloc_total numeric := 0;
  v_outstanding numeric;
  v_cash_account_code text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can record a Payment.';
  end if;

  select id into v_existing from public.payments where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_direction not in ('receipt','payment') then
    raise exception 'Invalid direction.';
  end if;
  if p_amount <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;

  select * into v_party from public.parties where id = p_party_id;
  if v_party.id is null then
    raise exception 'Party not found.';
  end if;
  if p_direction = 'receipt' and v_party.party_type not in ('client','both') then
    raise exception 'This party is not a Client.';
  end if;
  if p_direction = 'payment' and v_party.party_type not in ('supplier','both') then
    raise exception 'This party is not a Supplier.';
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_alloc_total := v_alloc_total + round((v_line->>'amount')::numeric, 2);
  end loop;
  if v_alloc_total > p_amount then
    raise exception 'Allocation total cannot exceed the payment amount.';
  end if;

  v_cash_account_code := case
    when p_petty_cash_fund_id is not null then '1060'
    when p_bank_account_id is not null then '1100'
    when p_method ilike 'cash' then '1050'
    else '1050'
  end;

  select public.fn_get_next_number('PAY') into v_payment_no;

  insert into public.payments
    (id, payment_no, party_id, direction, payment_date, method, reference_no, amount, unallocated_amount, notes,
     bank_account_id, petty_cash_fund_id, created_by)
  values
    (p_id, v_payment_no, p_party_id, p_direction, coalesce(p_payment_date, current_date), p_method, p_reference_no,
     p_amount, p_amount - v_alloc_total, p_notes, p_bank_account_id, p_petty_cash_fund_id, auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.payments where id = p_id;
    return v_existing;
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    if p_direction = 'receipt' then
      perform pg_advisory_xact_lock(hashtextextended('invoice:' || (v_line->>'invoice_id'), 0));

      select outstanding_amount into v_outstanding from public.invoice_outstanding
        where invoice_id = (v_line->>'invoice_id')::uuid and party_id = p_party_id;
      if v_outstanding is null then
        raise exception 'Invoice does not belong to this party, or was not found.';
      end if;
      if round((v_line->>'amount')::numeric, 2) > v_outstanding then
        raise exception 'Allocation exceeds the outstanding amount (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, invoice_id, amount)
      values (p_id, (v_line->>'invoice_id')::uuid, round((v_line->>'amount')::numeric, 2));
    else
      perform pg_advisory_xact_lock(hashtextextended('supplier_bill:' || (v_line->>'supplier_bill_id'), 0));

      select outstanding_amount into v_outstanding from public.supplier_bill_outstanding
        where supplier_bill_id = (v_line->>'supplier_bill_id')::uuid and supplier_id = p_party_id;
      if v_outstanding is null then
        raise exception 'Supplier Bill does not belong to this party, or was not found.';
      end if;
      if round((v_line->>'amount')::numeric, 2) > v_outstanding then
        raise exception 'Allocation exceeds the outstanding amount (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, supplier_bill_id, amount)
      values (p_id, (v_line->>'supplier_bill_id')::uuid, round((v_line->>'amount')::numeric, 2));
    end if;
  end loop;

  if p_direction = 'receipt' then
    perform public._fn_post_journal_entry_core(
      coalesce(p_payment_date, current_date), 'Receipt ' || v_payment_no, 'payments', p_id,
      jsonb_build_array(
        jsonb_build_object('account_code', v_cash_account_code, 'bank_account_id', p_bank_account_id, 'petty_cash_fund_id', p_petty_cash_fund_id, 'debit', p_amount, 'credit', 0, 'memo', 'Cash/Bank received'),
        jsonb_build_object('account_code', '1200', 'party_id', p_party_id, 'debit', 0, 'credit', p_amount, 'memo', 'Trade Receivables')
      )
    );
  else
    perform public._fn_post_journal_entry_core(
      coalesce(p_payment_date, current_date), 'Payment ' || v_payment_no, 'payments', p_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '2100', 'party_id', p_party_id, 'debit', p_amount, 'credit', 0, 'memo', 'Trade Payables'),
        jsonb_build_object('account_code', v_cash_account_code, 'bank_account_id', p_bank_account_id, 'petty_cash_fund_id', p_petty_cash_fund_id, 'debit', 0, 'credit', p_amount, 'memo', 'Cash/Bank paid')
      )
    );
  end if;

  return p_id;
end;
$$;

-- fn_allocate_payment
--
-- Latest definition: 20260911172338_phase7_01_concurrency_and_privilege_hardening.sql

create or replace function public.fn_allocate_payment(p_payment_id uuid, p_allocations jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_line jsonb;
  v_alloc_total numeric := 0;
  v_outstanding numeric;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts allocate kar sakte hain.';
  end if;
  if jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) = 0 then
    raise exception 'Kam az kam ek allocation honi chahiye.';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment.id is null then
    raise exception 'Payment nahi mili.';
  end if;
  if v_payment.status <> 'Posted' then
    raise exception 'Yeh Payment Posted nahi hai.';
  end if;

  for v_line in select * from jsonb_array_elements(p_allocations) loop
    v_alloc_total := v_alloc_total + round((v_line->>'amount')::numeric, 2);
  end loop;
  if v_alloc_total > v_payment.unallocated_amount then
    raise exception 'Allocation unallocated amount se zyada hai (unallocated: %).', v_payment.unallocated_amount;
  end if;

  for v_line in select * from jsonb_array_elements(p_allocations) loop
    if v_payment.direction = 'receipt' then
      perform pg_advisory_xact_lock(hashtextextended('invoice:' || (v_line->>'invoice_id'), 0));

      select outstanding_amount into v_outstanding from public.invoice_outstanding
        where invoice_id = (v_line->>'invoice_id')::uuid and party_id = v_payment.party_id;
      if v_outstanding is null then
        raise exception 'Invoice is party ki nahi hai ya mili nahi.';
      end if;
      if round((v_line->>'amount')::numeric, 2) > v_outstanding then
        raise exception 'Allocation outstanding se zyada hai (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, invoice_id, amount)
      values (p_payment_id, (v_line->>'invoice_id')::uuid, round((v_line->>'amount')::numeric, 2));
    else
      perform pg_advisory_xact_lock(hashtextextended('supplier_bill:' || (v_line->>'supplier_bill_id'), 0));

      select outstanding_amount into v_outstanding from public.supplier_bill_outstanding
        where supplier_bill_id = (v_line->>'supplier_bill_id')::uuid and supplier_id = v_payment.party_id;
      if v_outstanding is null then
        raise exception 'Supplier Bill is party ki nahi hai ya mili nahi.';
      end if;
      if round((v_line->>'amount')::numeric, 2) > v_outstanding then
        raise exception 'Allocation outstanding se zyada hai (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, supplier_bill_id, amount)
      values (p_payment_id, (v_line->>'supplier_bill_id')::uuid, round((v_line->>'amount')::numeric, 2));
    end if;
  end loop;

  update public.payments set unallocated_amount = unallocated_amount - v_alloc_total where id = p_payment_id;
end;
$$;

-- ===========================================================================
-- 13. fn_create_dispatch_go_ahead — only for Issued DCs, one open go-ahead
-- ===========================================================================
-- "Open" = Pending or Accepted (Accepted means the dispatcher is on the way);
-- a new go-ahead is allowed again once the previous one is Completed.

-- fn_create_dispatch_go_ahead
--
-- Latest definition: 20261003131000_phase41_02_dispatch_notifications_functions.sql

create or replace function public.fn_create_dispatch_go_ahead(p_delivery_challan_id uuid, p_given_to uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dc record;
  v_go_ahead_id uuid;
  v_given_to_name text;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Sirf Owner ya Sales Dispatch Go-Ahead de sakte hain.';
  end if;

  -- Phase 46.02: lock the DC so two go-aheads for it cannot race past the
  -- duplicate check below.
  select * into v_dc from public.delivery_challans where id = p_delivery_challan_id for update;
  if v_dc.id is null then
    raise exception 'Delivery Challan nahi mili.';
  end if;
  if v_dc.status <> 'Issued' then
    raise exception 'Go-Ahead sirf Issued Delivery Challan par diya ja sakta hai (status: %).', v_dc.status;
  end if;
  if exists (
    select 1 from public.dispatch_go_aheads g
    where g.delivery_challan_id = p_delivery_challan_id and g.status in ('Pending', 'Accepted')
  ) then
    raise exception 'Is Delivery Challan ka Go-Ahead pehle se pending hai.';
  end if;

  if not exists (
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = p_given_to and r.code = 'dispatch'
  ) then
    raise exception 'Yeh user Dispatch role mein nahi hai.';
  end if;

  insert into public.dispatch_go_aheads (delivery_challan_id, given_by, given_to)
  values (p_delivery_challan_id, auth.uid(), p_given_to)
  returning id into v_go_ahead_id;

  insert into public.notifications (recipient_user_id, type, title, description, href, related_table, related_id)
  values (
    p_given_to, 'dispatch_go_ahead_received', 'Delivery Go-Ahead — ' || v_dc.dc_no,
    'Accept to confirm you are taking this delivery.', '/delivery-challans/' || p_delivery_challan_id,
    'delivery_challans', p_delivery_challan_id
  );

  return v_go_ahead_id;
end;
$$;

-- ===========================================================================
-- 14. fn_cancel_purchase_order — lock the PO before the GRN check
-- ===========================================================================

-- fn_cancel_purchase_order
--
-- Latest definition: 20260913000200_phase21_02_translate_functions_batch_1.sql

CREATE OR REPLACE FUNCTION public.fn_cancel_purchase_order(p_purchase_order_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.is_owner() or public.has_role('store')) then
    raise exception 'Only Owner or Store can cancel.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason for cancelling is required.';
  end if;
  -- Phase 46.02: take the PO row lock first. fn_create_grn locks the same
  -- row FOR UPDATE, so a GRN committed concurrently is now either visible to
  -- the check below or blocked until this cancel finishes (and then refused
  -- by its own Cancelled-status check).
  perform 1 from public.purchase_orders where id = p_purchase_order_id for update;

  if exists (select 1 from public.grns where purchase_order_id = p_purchase_order_id) then
    raise exception 'Receiving has already occurred against this PO — it cannot be cancelled.';
  end if;

  update public.purchase_orders
    set status = 'Cancelled', cancel_reason = p_reason
    where id = p_purchase_order_id and status not in ('Cancelled','Closed','Received');

  if not found then
    raise exception 'This PO cannot be cancelled.';
  end if;
end;
$function$
;
