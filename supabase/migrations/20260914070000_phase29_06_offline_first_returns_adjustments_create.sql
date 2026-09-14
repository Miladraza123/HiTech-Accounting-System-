-- Phase 29.06 — Master Offline-First Roadmap, Phase 6: offline-first
-- CREATE for Sales Return, Purchase Return, Stock Transfer, and Stock
-- Adjustment (request).
--
-- Same idempotent-create pattern as every earlier phase: client-generated
-- UUID, safe to call twice with the same id.
--
-- Sales/Purchase Return — confirmed by reading the actual function
-- bodies, not assumed: "can't return more than was invoiced/billed" is
-- re-validated against LIVE invoice_lines.returned_qty /
-- supplier_bill_lines.returned_qty (re-read under `for update` at call
-- time), never a stale offline snapshot — exactly the plan's own
-- requirement for this phase. Purchase Return also deducts stock through
-- the same advisory-lock-protected, negative-balance-refusing
-- _fn_post_stock_ledger as Delivery Challan/Stock Transfer, so an offline
-- return that would take stock negative is likewise authoritatively
-- rejected at sync time.
--
-- Stock Transfer — already atomic across both warehouses (confirmed by
-- reading the body): the whole function is one Postgres transaction, so
-- a rejected "out" leg (insufficient stock at source — the same
-- negative-balance guard) rolls back the "in" leg too; no state where
-- stock leaves one warehouse without arriving at the other, online or
-- offline.
--
-- Stock Adjustment — offline-enables only the REQUEST step
-- (fn_request_stock_adjustment: a plain pending-row insert, no stock or
-- accounting impact at all). Approval (fn_approve_stock_adjustment) is
-- deliberately NOT offline-enabled: it's a distinct, Owner-only,
-- always-online review action on a request that must already exist
-- server-side, not a "create" in the sense this queue handles.
--
-- Same reachability constraint as every phase since Phase 2: each form
-- lives on a page that live-fetches its parent document (the Invoice for
-- a Sales Return, the Supplier Bill for a Purchase Return) and 404s if
-- not found. Stock Transfer and Stock Adjustment Request have no such
-- parent — both reference only master data (Item/Warehouse), so unlike
-- every other document in this roadmap they're reachable offline even
-- for master data created in a PRIOR (already-synced) offline session.

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
        order by created_at desc, id desc limit 1;
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

revoke execute on function public.fn_create_sales_return_idempotent(uuid, uuid, uuid, date, text, jsonb) from public, anon;
grant execute on function public.fn_create_sales_return_idempotent(uuid, uuid, uuid, date, text, jsonb) to authenticated;


create or replace function public.fn_create_purchase_return_idempotent(
  p_id uuid,
  p_supplier_bill_id uuid, p_warehouse_id uuid, p_return_date date, p_reason text, p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill record;
  v_po record;
  v_bl record;
  v_existing uuid;
  v_return_no text;
  v_line jsonb;
  v_qty numeric;
  v_amount numeric;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_lines jsonb := '[]'::jsonb;
begin
  if not (public.is_owner() or public.has_role('accounts') or public.has_role('store')) then
    raise exception 'Only Owner, Accounts or Store can create a Purchase Return.';
  end if;

  select id into v_existing from public.purchase_returns where id = p_id;
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
    raise exception 'Warehouse is required (where the stock returns from).';
  end if;

  select * into v_bill from public.supplier_bills where id = p_supplier_bill_id for update;
  if v_bill.id is null then
    raise exception 'Supplier Bill not found.';
  end if;
  if v_bill.status <> 'Posted' then
    raise exception 'A Purchase Return can only be created against a Posted Supplier Bill.';
  end if;

  select * into v_po from public.purchase_orders where id = v_bill.purchase_order_id;
  if v_po.id is null or v_po.purchase_type <> 'stock' then
    raise exception 'Purchase Return is only for stock-type purchases (a direct/general GRN already booked its Payable at receiving — use a Journal Voucher to correct it instead).';
  end if;

  select public.fn_get_next_number('PRN') into v_return_no;

  insert into public.purchase_returns (id, return_no, supplier_bill_id, supplier_id, warehouse_id, return_date, reason, created_by)
  values (p_id, v_return_no, p_supplier_bill_id, v_bill.supplier_id, p_warehouse_id, coalesce(p_return_date, current_date), p_reason, auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.purchase_returns where id = p_id;
    return v_existing;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_bl from public.supplier_bill_lines
      where id = (v_line->>'supplier_bill_line_id')::uuid and supplier_bill_id = p_supplier_bill_id
      for update;
    if v_bl.id is null then
      raise exception 'Bill line not found.';
    end if;

    v_qty := (v_line->>'qty')::numeric;
    if v_qty <= 0 then
      raise exception 'Return qty must be greater than zero.';
    end if;
    if v_bl.returned_qty + v_qty > v_bl.qty then
      raise exception 'Return qty cannot exceed billed qty (%, max returnable: %).', v_bl.description, v_bl.qty - v_bl.returned_qty;
    end if;

    v_amount := round(v_qty * v_bl.rate, 2);

    insert into public.purchase_return_lines (return_id, supplier_bill_line_id, item_id, description, qty, rate, tax_pct, sort_order)
    values (p_id, v_bl.id, v_bl.item_id, v_bl.description, v_qty, v_bl.rate, v_bl.tax_pct, 0);

    update public.supplier_bill_lines set returned_qty = returned_qty + v_qty where id = v_bl.id;

    if v_bl.item_id is not null then
      perform public._fn_post_stock_ledger(v_bl.item_id, p_warehouse_id, 'PRN', -v_qty, v_bl.rate, 'purchase_returns', p_id, 'Purchase Return ' || v_return_no);
    end if;

    v_subtotal := v_subtotal + v_amount;
    v_tax_total := v_tax_total + round(v_amount * v_bl.tax_pct / 100, 2);
  end loop;

  update public.purchase_returns
    set subtotal = round(v_subtotal, 2), tax_total = round(v_tax_total, 2), grand_total = round(v_subtotal + v_tax_total, 2)
    where id = p_id;

  v_lines := v_lines || jsonb_build_object('account_code', '2100', 'party_id', v_bill.supplier_id, 'debit', round(v_subtotal + v_tax_total, 2), 'credit', 0, 'memo', 'Trade Payables — reduced by return');
  if v_tax_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1400', 'party_id', null, 'debit', 0, 'credit', round(v_tax_total, 2), 'memo', 'Input Sales Tax — reversed');
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', '1310', 'party_id', null, 'debit', 0, 'credit', round(v_subtotal, 2), 'memo', 'Raw Material Inventory — returned to supplier');

  perform public._fn_post_journal_entry_core(
    coalesce(p_return_date, current_date), 'Purchase Return ' || v_return_no || ' (Bill ' || v_bill.bill_no || ')', 'purchase_returns', p_id, v_lines
  );

  return p_id;
end;
$$;

revoke execute on function public.fn_create_purchase_return_idempotent(uuid, uuid, uuid, date, text, jsonb) from public, anon;
grant execute on function public.fn_create_purchase_return_idempotent(uuid, uuid, uuid, date, text, jsonb) to authenticated;


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
      order by created_at desc, id desc limit 1;
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

revoke execute on function public.fn_create_stock_transfer_idempotent(uuid, uuid, uuid, date, text, jsonb) from public, anon;
grant execute on function public.fn_create_stock_transfer_idempotent(uuid, uuid, uuid, date, text, jsonb) to authenticated;


create or replace function public.fn_request_stock_adjustment_idempotent(
  p_id uuid,
  p_item_id uuid,
  p_warehouse_id uuid,
  p_qty_delta numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
begin
  if not (public.is_owner() or public.has_role('store')) then
    raise exception 'Only Owner or Store can request a stock adjustment.';
  end if;

  select id into v_existing from public.stock_adjustments where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required.';
  end if;
  if p_qty_delta = 0 then
    raise exception 'Qty delta cannot be zero.';
  end if;

  insert into public.stock_adjustments (id, item_id, warehouse_id, qty_delta, reason, requested_by)
  values (p_id, p_item_id, p_warehouse_id, p_qty_delta, p_reason, auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.stock_adjustments where id = p_id;
  end if;

  return v_existing;
end;
$$;

revoke execute on function public.fn_request_stock_adjustment_idempotent(uuid, uuid, uuid, numeric, text) from public, anon;
grant execute on function public.fn_request_stock_adjustment_idempotent(uuid, uuid, uuid, numeric, text) to authenticated;
