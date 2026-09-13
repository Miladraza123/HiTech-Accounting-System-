-- phase21_02_translate_fn_batch_2
-- Translates Roman-Urdu user-facing exception/notice/warning messages inside
-- fn_cancel_sales_order, fn_cancel_sales_return, fn_cancel_stock_transfer,
-- fn_cancel_supplier_bill, fn_cancel_task, fn_complete_task,
-- fn_create_bank_account, fn_create_contra_entry, fn_create_delivery_challan
-- into professional English. No logic, control flow, SQL, or signatures changed.

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

  update public.sales_orders
    set status = 'Cancelled', cancel_reason = p_reason
    where id = p_sales_order_id and status not in ('Cancelled','Closed')
    returning query_id, so_no into v_query_id, v_so_no;

  if v_query_id is null then
    raise exception 'This Sales Order cannot be cancelled (it may already be Cancelled/Closed).';
  end if;

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', v_query_id, 'status_change', 'Sales Order ' || v_so_no || ' cancel hui. Wajah: ' || p_reason, auth.uid());
end;
$function$;

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

    if v_line.item_id is not null and v_line.stock_value > 0 then
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

CREATE OR REPLACE FUNCTION public.fn_cancel_stock_transfer(p_transfer_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_transfer record;
  v_line record;
begin
  if not (public.is_owner() or public.has_role('store')) then
    raise exception 'Only Owner or Store can cancel a Stock Transfer.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason for cancelling is required.';
  end if;

  select * into v_transfer from public.stock_transfers where id = p_transfer_id for update;
  if v_transfer.id is null then
    raise exception 'Stock Transfer not found.';
  end if;
  if v_transfer.status = 'Cancelled' then
    raise exception 'This Stock Transfer is already cancelled.';
  end if;

  for v_line in select * from public.stock_transfer_lines where transfer_id = p_transfer_id loop
    -- Reverse: remove from destination (fails if already consumed there),
    -- add back to source.
    perform public._fn_post_stock_ledger(v_line.item_id, v_transfer.to_warehouse_id, 'STN', -v_line.qty, 0, 'stock_transfers', p_transfer_id, 'Transfer ' || v_transfer.transfer_no || ' — cancelled');
    perform public._fn_post_stock_ledger(v_line.item_id, v_transfer.from_warehouse_id, 'STN', v_line.qty, v_line.rate, 'stock_transfers', p_transfer_id, 'Transfer ' || v_transfer.transfer_no || ' — cancelled');
  end loop;

  update public.stock_transfers set status = 'Cancelled', cancel_reason = p_reason where id = p_transfer_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_cancel_supplier_bill(p_supplier_bill_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_bill record;
  v_lines jsonb := '[]'::jsonb;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can cancel a Supplier Bill.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason for cancelling is required.';
  end if;

  select * into v_bill from public.supplier_bills where id = p_supplier_bill_id for update;
  if v_bill.id is null then
    raise exception 'Supplier Bill not found.';
  end if;
  if v_bill.status = 'Cancelled' then
    raise exception 'This Bill is already cancelled.';
  end if;
  if exists (
    select 1 from public.payment_allocations pa join public.payments p on p.id = pa.payment_id
    where pa.supplier_bill_id = p_supplier_bill_id and p.status = 'Posted'
  ) then
    raise exception 'A payment has already been allocated against this Bill — cancel the payment first.';
  end if;
  if exists (select 1 from public.purchase_returns where supplier_bill_id = p_supplier_bill_id and status = 'Posted') then
    raise exception 'A Purchase Return has already been made against this Bill — cancel the Purchase Return first.';
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

CREATE OR REPLACE FUNCTION public.fn_cancel_task(p_task_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_task record;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'Task not found.';
  end if;
  if not (public.is_owner() or v_task.created_by = auth.uid()) then
    raise exception 'Only the task creator or Owner can cancel it.';
  end if;
  if v_task.status <> 'Open' then
    raise exception 'Only an Open task can be cancelled.';
  end if;

  update public.tasks
  set status = 'Cancelled', cancel_reason = p_reason, updated_by = auth.uid()
  where id = p_task_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_complete_task(p_task_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_task record;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'Task not found.';
  end if;
  if not (public.is_owner() or v_task.created_by = auth.uid() or v_task.assigned_to = auth.uid()) then
    raise exception 'Only the assignee, task creator, or Owner can complete it.';
  end if;
  if v_task.status <> 'Open' then
    raise exception 'Only an Open task can be completed.';
  end if;

  update public.tasks
  set status = 'Done', completed_at = now(), completed_by = auth.uid(), updated_by = auth.uid()
  where id = p_task_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_create_bank_account(p_account_name text, p_bank_name text, p_account_number text, p_branch text, p_opening_balance numeric DEFAULT 0, p_opening_balance_date date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can create a Bank Account.';
  end if;
  if coalesce(trim(p_account_name), '') = '' then
    raise exception 'Account name is required.';
  end if;

  insert into public.bank_accounts (account_name, bank_name, account_number, branch, created_by)
  values (trim(p_account_name), nullif(trim(p_bank_name), ''), nullif(trim(p_account_number), ''), nullif(trim(p_branch), ''), auth.uid())
  returning id into v_id;

  if coalesce(p_opening_balance, 0) <> 0 then
    perform public._fn_post_journal_entry_core(
      coalesce(p_opening_balance_date, current_date), 'Opening Balance — ' || trim(p_account_name), 'bank_accounts', v_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '1100', 'bank_account_id', v_id, 'debit', greatest(p_opening_balance, 0), 'credit', greatest(-p_opening_balance, 0), 'memo', 'Opening Balance'),
        jsonb_build_object('account_code', '1900', 'debit', greatest(-p_opening_balance, 0), 'credit', greatest(p_opening_balance, 0), 'memo', 'Opening Balance Equity')
      )
    );
  end if;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_create_contra_entry(p_transfer_date date, p_from_type text, p_from_bank_account_id uuid, p_from_petty_cash_fund_id uuid, p_to_type text, p_to_bank_account_id uuid, p_to_petty_cash_fund_id uuid, p_amount numeric, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid := gen_random_uuid();
  v_no text;
  v_journal_id uuid;
  v_from_code text;
  v_to_code text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can make a Transfer.';
  end if;
  if p_amount <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;
  if p_from_type not in ('cash', 'bank', 'petty_cash') or p_to_type not in ('cash', 'bank', 'petty_cash') then
    raise exception 'Transfer type is invalid.';
  end if;
  if p_from_type = 'bank' and p_from_bank_account_id is null then
    raise exception 'Select a Source Bank Account.';
  end if;
  if p_from_type = 'petty_cash' and p_from_petty_cash_fund_id is null then
    raise exception 'Select a Source Petty Cash Fund.';
  end if;
  if p_to_type = 'bank' and p_to_bank_account_id is null then
    raise exception 'Select a Destination Bank Account.';
  end if;
  if p_to_type = 'petty_cash' and p_to_petty_cash_fund_id is null then
    raise exception 'Select a Destination Petty Cash Fund.';
  end if;
  if p_from_type = p_to_type
     and coalesce(p_from_bank_account_id, p_from_petty_cash_fund_id) is not distinct from coalesce(p_to_bank_account_id, p_to_petty_cash_fund_id) then
    raise exception 'Source and Destination cannot be the same.';
  end if;

  v_from_code := case p_from_type when 'bank' then '1100' when 'petty_cash' then '1060' else '1050' end;
  v_to_code := case p_to_type when 'bank' then '1100' when 'petty_cash' then '1060' else '1050' end;

  select public.fn_get_next_number('CT') into v_no;

  v_journal_id := public._fn_post_journal_entry_core(
    coalesce(p_transfer_date, current_date), 'Fund Transfer ' || v_no, 'contra_transfers', v_id,
    jsonb_build_array(
      jsonb_build_object('account_code', v_to_code, 'bank_account_id', p_to_bank_account_id, 'petty_cash_fund_id', p_to_petty_cash_fund_id, 'debit', p_amount, 'credit', 0, 'memo', 'Transfer in'),
      jsonb_build_object('account_code', v_from_code, 'bank_account_id', p_from_bank_account_id, 'petty_cash_fund_id', p_from_petty_cash_fund_id, 'debit', 0, 'credit', p_amount, 'memo', 'Transfer out')
    )
  );

  insert into public.contra_transfers
    (id, transfer_no, transfer_date, from_type, from_bank_account_id, from_petty_cash_fund_id,
     to_type, to_bank_account_id, to_petty_cash_fund_id, amount, notes, journal_entry_id, created_by)
  values
    (v_id, v_no, coalesce(p_transfer_date, current_date), p_from_type, p_from_bank_account_id, p_from_petty_cash_fund_id,
     p_to_type, p_to_bank_account_id, p_to_petty_cash_fund_id, p_amount, nullif(trim(p_notes), ''), v_journal_id, auth.uid());

  return v_id;
end;
$function$;

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
    v_stock_qty := coalesce((v_line->>'stock_qty')::numeric, v_qty);
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
        order by created_at desc, id desc limit 1;
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
