-- Phase 29.03 — Master Offline-First Roadmap, Phase 3: offline-first
-- CREATE for Purchase Order, GRN (goods receipt — the app's first
-- stock-AND-accounting-posting offline create), and Supplier Bill.
--
-- Same idempotent-create pattern as Phases 1-2: client-generated UUID,
-- safe to call twice with the same id. Every function below runs as ONE
-- Postgres transaction already (a plpgsql SECURITY DEFINER function's
-- body is implicitly transactional) — a failure anywhere inside it (a
-- thrown exception from a downstream check) rolls back everything it did,
-- including any stock/journal postings already made in that same call.
-- So the same "check my own id first, on conflict (id) do nothing on the
-- header insert, re-select and return early on a lost race" guard used
-- for Quotation/Sales Order is enough here too: nothing partially posts.
--
-- GRN specifically (_fn_post_stock_ledger / _fn_post_journal_entry_core):
-- confirmed by reading the actual function body, not assumed — GRN never
-- re-derives "how much was already received" from anything the offline
-- client remembers; it always re-reads `purchase_order_lines.received_qty`
-- live under `for update` at the moment it actually runs, so a queued
-- offline GRN naturally gets re-validated against whatever the true
-- server-side receiving progress is by the time it syncs, never a stale
-- offline snapshot. GRN also only ever ADDS to stock (a receipt), so
-- there is no "would go negative" rejection risk the way a deduction
-- (Delivery, a later phase) would have — the advisory-lock-protected
-- `_fn_post_stock_ledger` here is purely about correct weighted-average
-- costing under concurrent postings for the same item+warehouse, which it
-- already handles regardless of caller.
--
-- Supplier Bill: the existing business rule ("this GRN already has a
-- non-cancelled bill") is ALSO already enforced by a real unique index
-- (`uq_supplier_bill_grn`), not just an app-level check — so a genuine
-- duplicate submission (a different client-generated id trying to bill
-- the same GRN twice) is rejected at the database level regardless. The
-- idempotent wrapper's own id-first check is what makes a RETRY of the
-- client's OWN prior submission (same id, e.g. after a dropped
-- connection) return the existing bill silently instead of hitting that
-- same rejection — without it, a network-drop-after-commit would leave
-- the offline queue permanently stuck reporting "already billed" for a
-- submission that actually succeeded.
--
-- Reachability constraint (same as Phase 2's Quotation/Sales Order):
-- each of these forms lives on a page that live-fetches its parent
-- record (the PO for a GRN, the GRN for a Supplier Bill) and 404s if not
-- found — so none of these three is reachable offline when its own
-- parent was ALSO created offline and hasn't synced yet.

create or replace function public.fn_create_purchase_order_idempotent(
  p_id uuid,
  p_supplier_id uuid,
  p_purchase_type text,
  p_linked_sales_order_id uuid,
  p_warehouse_id uuid,
  p_expected_delivery date,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_po_no text;
  v_line jsonb;
  v_idx int := 0;
begin
  if not (public.is_owner() or public.has_role('store')) then
    raise exception 'Only Owner or Store can create a Purchase Order.';
  end if;

  select id into v_existing from public.purchase_orders where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_purchase_type not in ('direct','stock','general') then
    raise exception 'Invalid purchase type.';
  end if;
  if p_purchase_type = 'direct' and p_linked_sales_order_id is null then
    raise exception 'A direct purchase must be linked to a Sales Order.';
  end if;
  if p_purchase_type = 'stock' and p_warehouse_id is null then
    raise exception 'Warehouse is required for a stock purchase.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'A Purchase Order needs at least one line.';
  end if;

  select public.fn_get_next_number('PO') into v_po_no;

  insert into public.purchase_orders
    (id, po_no, supplier_id, purchase_type, linked_sales_order_id, warehouse_id, expected_delivery, responsible_user_id, created_by)
  values
    (p_id, v_po_no, p_supplier_id, p_purchase_type, p_linked_sales_order_id, p_warehouse_id, p_expected_delivery, auth.uid(), auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.purchase_orders where id = p_id;
    return v_existing;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.purchase_order_lines (purchase_order_id, item_id, description, ordered_qty, unit, rate, tax_pct, sort_order)
    values (
      p_id,
      nullif(v_line->>'item_id','')::uuid,
      v_line->>'description',
      (v_line->>'ordered_qty')::numeric,
      nullif(v_line->>'unit',''),
      (v_line->>'rate')::numeric,
      coalesce((v_line->>'tax_pct')::numeric, 0),
      v_idx
    );
    v_idx := v_idx + 1;
  end loop;

  perform public._fn_recalc_po_totals(p_id);
  return p_id;
end;
$$;

revoke execute on function public.fn_create_purchase_order_idempotent(uuid, uuid, text, uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.fn_create_purchase_order_idempotent(uuid, uuid, text, uuid, uuid, date, jsonb) to authenticated;


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

  v_effective_warehouse := coalesce(p_warehouse_id, v_po.warehouse_id);
  if v_po.purchase_type = 'stock' and v_effective_warehouse is null then
    raise exception 'Warehouse is required.';
  end if;

  select public.fn_get_next_number('GRN') into v_grn_no;

  insert into public.grns (id, grn_no, supplier_id, purchase_order_id, received_date, warehouse_id, remarks, created_by)
  values (p_id, v_grn_no, p_supplier_id, p_purchase_order_id, p_received_date, v_effective_warehouse, p_remarks, auth.uid())
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
        jsonb_build_object('account_code','1330','party_id',p_supplier_id,'debit',0,'credit',v_stock_base_total,'memo','GRN Clearing')
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
      v_lines := v_lines || jsonb_build_object('account_code','2100','party_id',p_supplier_id,'debit',0,'credit',v_expense_base_total + v_expense_tax_total,'memo','Trade Payables');

      perform public._fn_post_journal_entry_core(
        p_received_date, 'GRN ' || v_grn_no || ' — ' || v_po.purchase_type || ' purchase', 'grns', p_id, v_lines
      );
    end;
  end if;

  return p_id;
end;
$$;

revoke execute on function public.fn_create_grn_idempotent(uuid, uuid, uuid, date, uuid, text, jsonb) from public, anon;
grant execute on function public.fn_create_grn_idempotent(uuid, uuid, uuid, date, uuid, text, jsonb) to authenticated;


create or replace function public.fn_create_supplier_bill_idempotent(
  p_id uuid,
  p_grn_id uuid,
  p_bill_date date,
  p_supplier_bill_ref text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grn record;
  v_po record;
  v_gl record;
  v_existing uuid;
  v_bill_no text;
  v_amount numeric;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  v_line_count int := 0;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can create a Supplier Bill.';
  end if;

  select id into v_existing from public.supplier_bills where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_grn from public.grns where id = p_grn_id for update;
  if v_grn.id is null then
    raise exception 'GRN not found.';
  end if;

  select * into v_po from public.purchase_orders where id = v_grn.purchase_order_id;
  if v_po.purchase_type <> 'stock' then
    raise exception 'This GRN''s Trade Payables was already booked at receiving — no separate Supplier Bill is needed.';
  end if;

  -- Real duplicate check, not just this client's own retry: someone else
  -- (or this same device, before ever queuing this offline write) may
  -- already have billed this GRN under a DIFFERENT id while this one was
  -- still offline — that's a genuine conflict the DB also independently
  -- enforces via uq_supplier_bill_grn, surfaced here with the same
  -- message the online path already uses.
  if exists (select 1 from public.supplier_bills where grn_id = p_grn_id and status <> 'Cancelled') then
    raise exception 'A Supplier Bill for this GRN already exists.';
  end if;

  select public.fn_get_next_number('BILL') into v_bill_no;

  insert into public.supplier_bills
    (id, bill_no, supplier_id, purchase_order_id, grn_id, bill_date, supplier_bill_ref, created_by)
  values
    (p_id, v_bill_no, v_grn.supplier_id, v_grn.purchase_order_id, p_grn_id, coalesce(p_bill_date, current_date), p_supplier_bill_ref, auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.supplier_bills where id = p_id;
    return v_existing;
  end if;

  for v_gl in select * from public.grn_lines where grn_id = p_grn_id loop
    v_line_count := v_line_count + 1;
    v_amount := round(v_gl.this_receipt_qty * v_gl.rate, 2);

    insert into public.supplier_bill_lines
      (supplier_bill_id, grn_line_id, item_id, description, qty, rate, tax_pct, sort_order)
    values
      (p_id, v_gl.id, v_gl.item_id, coalesce((select description from public.items where id = v_gl.item_id), 'Item'), v_gl.this_receipt_qty, v_gl.rate, v_gl.tax_pct, v_line_count);

    v_subtotal := v_subtotal + v_amount;
    v_tax_total := v_tax_total + round(v_amount * v_gl.tax_pct / 100, 2);
  end loop;

  if v_line_count = 0 then
    raise exception 'This GRN has no lines.';
  end if;

  update public.supplier_bills
    set subtotal = round(v_subtotal, 2), tax_total = round(v_tax_total, 2), grand_total = round(v_subtotal + v_tax_total, 2)
    where id = p_id;

  v_lines := v_lines || jsonb_build_object('account_code', '1330', 'party_id', v_grn.supplier_id, 'debit', round(v_subtotal, 2), 'credit', 0, 'memo', 'GRN Clearing');
  if v_tax_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1400', 'party_id', null, 'debit', round(v_tax_total, 2), 'credit', 0, 'memo', 'Input Sales Tax');
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', '2100', 'party_id', v_grn.supplier_id, 'debit', 0, 'credit', round(v_subtotal + v_tax_total, 2), 'memo', 'Trade Payables');

  perform public._fn_post_journal_entry_core(coalesce(p_bill_date, current_date), 'Supplier Bill ' || v_bill_no, 'supplier_bills', p_id, v_lines);

  return p_id;
end;
$$;

revoke execute on function public.fn_create_supplier_bill_idempotent(uuid, uuid, date, text) from public, anon;
grant execute on function public.fn_create_supplier_bill_idempotent(uuid, uuid, date, text) to authenticated;
