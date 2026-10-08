-- Phase 46.03 — "Add New Item" inline on the Receive Goods (GRN) screen.
--
-- Item selection on a Purchase Order line is deliberately optional (see
-- QuotationLineEditor's "Item (optional)" column) — a Quotation-style
-- custom/no-catalog line is legitimate there. But a "stock" purchase line
-- with no item was only ever caught at GRN time, by fn_create_grn's own
-- "Every line of a stock purchase must have an item" guard — by then goods
-- have physically arrived and the PO (create/cancel/close only, no amend)
-- can't be fixed in place.
--
-- Fix: GRN itself can now carry an item_id per line. If the PO line
-- doesn't have one yet, it gets backfilled here (one-time — a line that
-- already has an item keeps it, a client-sent item_id is ignored) before
-- the existing stock-purchase check runs, so the store person can pick or
-- create the right Item right there and finish receiving in one step.
create or replace function public.fn_create_grn(
  p_supplier_id uuid,
  p_purchase_order_id uuid,
  p_received_date date,
  p_warehouse_id uuid,
  p_remarks text,
  p_lines jsonb -- [{po_line_id, this_receipt_qty, item_id?}]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po record;
  v_pol record;
  v_grn_id uuid;
  v_grn_no text;
  v_line jsonb;
  v_new_item_id uuid;
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

    if v_pol.item_id is null then
      v_new_item_id := nullif(v_line->>'item_id', '')::uuid;
      if v_new_item_id is not null then
        update public.purchase_order_lines set item_id = v_new_item_id where id = v_pol.id;
        v_pol.item_id := v_new_item_id;
      end if;
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
$$;

create or replace function public.fn_create_grn_idempotent(
  p_id uuid,
  p_supplier_id uuid,
  p_purchase_order_id uuid,
  p_received_date date,
  p_warehouse_id uuid,
  p_remarks text,
  p_lines jsonb -- [{po_line_id, this_receipt_qty, item_id?}]
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
  v_new_item_id uuid;
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

    if v_pol.item_id is null then
      v_new_item_id := nullif(v_line->>'item_id', '')::uuid;
      if v_new_item_id is not null then
        update public.purchase_order_lines set item_id = v_new_item_id where id = v_pol.id;
        v_pol.item_id := v_new_item_id;
      end if;
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

revoke execute on function public.fn_create_grn_idempotent(uuid, uuid, uuid, date, uuid, text, jsonb) from public, anon;
