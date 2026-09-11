create or replace function public.fn_create_purchase_order(
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
  v_po_id uuid;
  v_po_no text;
  v_line jsonb;
  v_idx int := 0;
begin
  if not (public.is_owner() or public.has_role('store')) then
    raise exception 'Sirf Owner ya Store Purchase Order bana sakte hain.';
  end if;
  if p_purchase_type not in ('direct','stock','general') then
    raise exception 'Purchase type ghalat hai.';
  end if;
  if p_purchase_type = 'direct' and p_linked_sales_order_id is null then
    raise exception 'Direct purchase kisi Sales Order se link honi chahiye.';
  end if;
  if p_purchase_type = 'stock' and p_warehouse_id is null then
    raise exception 'Stock purchase ke liye warehouse zaroori hai.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Purchase Order mein kam az kam ek line honi chahiye.';
  end if;

  select public.fn_get_next_number('PO') into v_po_no;

  insert into public.purchase_orders
    (po_no, supplier_id, purchase_type, linked_sales_order_id, warehouse_id, expected_delivery, responsible_user_id, created_by)
  values
    (v_po_no, p_supplier_id, p_purchase_type, p_linked_sales_order_id, p_warehouse_id, p_expected_delivery, auth.uid(), auth.uid())
  returning id into v_po_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.purchase_order_lines (purchase_order_id, item_id, description, ordered_qty, unit, rate, tax_pct, sort_order)
    values (
      v_po_id,
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

  perform public._fn_recalc_po_totals(v_po_id);
  return v_po_id;
end;
$$;

create or replace function public.fn_cancel_purchase_order(p_purchase_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_owner() or public.has_role('store')) then
    raise exception 'Sirf Owner ya Store cancel kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancel karne ki wajah likhna zaroori hai.';
  end if;
  if exists (select 1 from public.grns where purchase_order_id = p_purchase_order_id) then
    raise exception 'Is PO par receiving ho chuki hai — cancel nahi ho sakti.';
  end if;

  update public.purchase_orders
    set status = 'Cancelled', cancel_reason = p_reason
    where id = p_purchase_order_id and status not in ('Cancelled','Closed','Received');

  if not found then
    raise exception 'Yeh PO cancel nahi ho sakti.';
  end if;
end;
$$;

-- Receive against a PO. For 'stock' lines this posts to the stock ledger
-- and books Dr Raw Material Inventory / Cr GRN Clearing (bill booking —
-- Phase 5 — later moves this from Clearing to Trade Payables). For
-- 'direct' and 'general' lines there is no stock impact at all; the
-- expense is booked straight to Trade Payables at receipt, as the
-- blueprint specifies for the non-stocked Material Supply path.
--
-- NOTE: superseded by the version in phase3_05 (calls
-- _fn_post_journal_entry_core instead of the Owner/Accounts-gated
-- fn_post_journal_entry) — kept here for migration history accuracy.
create or replace function public.fn_create_grn(
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
    raise exception 'Sirf Owner ya Store receiving kar sakte hain.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'GRN mein kam az kam ek line honi chahiye.';
  end if;

  select * into v_po from public.purchase_orders where id = p_purchase_order_id for update;
  if v_po.id is null then
    raise exception 'Purchase Order nahi mili.';
  end if;
  if v_po.status in ('Cancelled','Closed') then
    raise exception 'Is PO par receiving nahi ki ja sakti (% hai).', v_po.status;
  end if;

  v_effective_warehouse := coalesce(p_warehouse_id, v_po.warehouse_id);
  if v_po.purchase_type = 'stock' and v_effective_warehouse is null then
    raise exception 'Warehouse zaroori hai.';
  end if;

  select public.fn_get_next_number('GRN') into v_grn_no;

  insert into public.grns (grn_no, supplier_id, purchase_order_id, received_date, warehouse_id, remarks, created_by)
  values (v_grn_no, p_supplier_id, p_purchase_order_id, p_received_date, v_effective_warehouse, p_remarks, auth.uid())
  returning id into v_grn_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_pol from public.purchase_order_lines
      where id = (v_line->>'po_line_id')::uuid and purchase_order_id = p_purchase_order_id
      for update;
    if v_pol.id is null then
      raise exception 'PO line nahi mili.';
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
        raise exception 'Stock purchase ki har line ka item hona zaroori hai.';
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

  -- Recompute PO status from the lines' receiving progress
  select
    bool_and(received_qty >= ordered_qty),
    bool_or(received_qty > 0)
    into v_all_received, v_any_received
    from public.purchase_order_lines where purchase_order_id = p_purchase_order_id;

  update public.purchase_orders
    set status = case when v_all_received then 'Received' when v_any_received then 'PartiallyReceived' else status end
    where id = p_purchase_order_id;

  -- Post accounting
  if v_stock_base_total > 0 then
    perform public.fn_post_journal_entry(
      p_received_date, 'GRN ' || v_grn_no || ' — stock received', 'grns', v_grn_id,
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

      perform public.fn_post_journal_entry(
        p_received_date, 'GRN ' || v_grn_no || ' — ' || v_po.purchase_type || ' purchase', 'grns', v_grn_id, v_lines
      );
    end;
  end if;

  return v_grn_id;
end;
$$;

revoke execute on function public.fn_create_purchase_order(uuid, text, uuid, uuid, date, jsonb) from public, anon;
revoke execute on function public.fn_cancel_purchase_order(uuid, text) from public, anon;
revoke execute on function public.fn_create_grn(uuid, uuid, date, uuid, text, jsonb) from public, anon;

grant execute on function public.fn_create_purchase_order(uuid, text, uuid, uuid, date, jsonb) to authenticated;
grant execute on function public.fn_cancel_purchase_order(uuid, text) to authenticated;
grant execute on function public.fn_create_grn(uuid, uuid, date, uuid, text, jsonb) to authenticated;
