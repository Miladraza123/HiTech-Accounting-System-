-- Ungated core: does the actual posting, no role check. Only callable from
-- other SECURITY DEFINER functions in this schema (never granted to any
-- client role) — each caller (fn_post_journal_entry, fn_create_grn, …)
-- is responsible for checking its own role before reaching here.
create or replace function public._fn_post_journal_entry_core(
  p_entry_date date,
  p_narration text,
  p_source_table text,
  p_source_id uuid,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_entry_no text;
  v_line jsonb;
  v_account_id uuid;
begin
  select public.fn_get_next_number('JV') into v_entry_no;

  insert into public.journal_entries (entry_no, entry_date, narration, source_table, source_id, created_by)
  values (v_entry_no, p_entry_date, p_narration, p_source_table, p_source_id, auth.uid())
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select id into v_account_id from public.chart_of_accounts where code = v_line->>'account_code';
    if v_account_id is null then
      raise exception 'Unknown chart of accounts code: %', v_line->>'account_code';
    end if;
    insert into public.journal_lines (journal_entry_id, account_id, party_id, debit, credit, memo)
    values (
      v_entry_id,
      v_account_id,
      nullif(v_line->>'party_id','')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      v_line->>'memo'
    );
  end loop;

  return v_entry_id;
end;
$$;

revoke execute on function public._fn_post_journal_entry_core(date, text, text, uuid, jsonb) from public, anon, authenticated;

-- Public/gated entry point (Import Wizard opening balances, any future
-- manual-journal screen): checks role, then delegates to the core.
create or replace function public.fn_post_journal_entry(
  p_entry_date date,
  p_narration text,
  p_source_table text,
  p_source_id uuid,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts may post journal entries.';
  end if;
  return public._fn_post_journal_entry_core(p_entry_date, p_narration, p_source_table, p_source_id, p_lines);
end;
$$;

-- fn_create_grn already checked Owner/Store at its own entry point; it
-- posts a fully deterministic, structured entry — call the ungated core
-- directly instead of the Owner/Accounts-gated public wrapper.
create or replace function public.fn_create_grn(
  p_supplier_id uuid,
  p_purchase_order_id uuid,
  p_received_date date,
  p_warehouse_id uuid,
  p_remarks text,
  p_lines jsonb
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
        p_received_date, 'GRN ' || v_grn_no || ' — ' || v_po.purchase_type || ' purchase', 'grns', v_grn_id, v_lines
      );
    end;
  end if;

  return v_grn_id;
end;
$$;
