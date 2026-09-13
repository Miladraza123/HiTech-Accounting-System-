-- Translates Roman-Urdu user-facing exception/notice messages inside the
-- listed PL/pgSQL functions into professional English. No logic, control
-- flow, SQL, signatures, or comments are changed — only the text inside
-- raise exception/notice/warning string literals is translated.

CREATE OR REPLACE FUNCTION public.fn_create_expense(p_expense_date date, p_expense_head_id uuid, p_amount numeric, p_payment_source text, p_bank_account_id uuid, p_petty_cash_fund_id uuid, p_job_id uuid, p_responsible_user_id uuid, p_department text, p_description text, p_vehicle_id uuid DEFAULT NULL::uuid, p_odometer_reading numeric DEFAULT NULL::numeric, p_fuel_litres numeric DEFAULT NULL::numeric, p_fuel_rate numeric DEFAULT NULL::numeric, p_settlement_status text DEFAULT 'Settled'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_head record;
  v_expense_id uuid;
  v_expense_no text;
  v_credit_account_code text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can record an Expense.';
  end if;
  if p_amount <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;
  if p_payment_source not in ('cash', 'bank', 'petty_cash') then
    raise exception 'Payment source is invalid.';
  end if;
  if p_payment_source = 'bank' and p_bank_account_id is null then
    raise exception 'Please select a Bank Account.';
  end if;
  if p_payment_source = 'petty_cash' and p_petty_cash_fund_id is null then
    raise exception 'Please select a Petty Cash Fund.';
  end if;
  if coalesce(p_settlement_status, 'Settled') not in ('Settled','Pending') then
    raise exception 'Settlement status is invalid.';
  end if;

  select * into v_head from public.expense_heads where id = p_expense_head_id and is_active;
  if v_head.id is null then
    raise exception 'Expense Head not found.';
  end if;

  v_credit_account_code := case p_payment_source when 'bank' then '1100' when 'petty_cash' then '1060' else '1050' end;

  select public.fn_get_next_number('EXP') into v_expense_no;

  insert into public.expenses
    (expense_no, expense_date, expense_head_id, amount, payment_source, bank_account_id, petty_cash_fund_id,
     job_id, responsible_user_id, department, description, vehicle_id, odometer_reading, fuel_litres, fuel_rate,
     settlement_status, created_by)
  values
    (v_expense_no, coalesce(p_expense_date, current_date), p_expense_head_id, p_amount, p_payment_source,
     case when p_payment_source = 'bank' then p_bank_account_id end,
     case when p_payment_source = 'petty_cash' then p_petty_cash_fund_id end,
     p_job_id, p_responsible_user_id, nullif(trim(p_department), ''), nullif(trim(p_description), ''),
     p_vehicle_id, p_odometer_reading, p_fuel_litres, p_fuel_rate, coalesce(p_settlement_status, 'Settled'), auth.uid())
  returning id into v_expense_id;

  -- Keep the vehicle's live meter reading in sync — only ever moves forward,
  -- never regresses (so a backdated/historical entry doesn't corrupt it).
  if p_vehicle_id is not null and p_odometer_reading is not null then
    update public.vehicles
      set current_meter_reading = p_odometer_reading
      where id = p_vehicle_id and p_odometer_reading > current_meter_reading;
  end if;

  perform public._fn_post_journal_entry_core(
    coalesce(p_expense_date, current_date), 'Expense ' || v_expense_no || ' — ' || v_head.name, 'expenses', v_expense_id,
    jsonb_build_array(
      jsonb_build_object('account_code', v_head.account_code, 'debit', p_amount, 'credit', 0, 'memo', v_head.name),
      jsonb_build_object(
        'account_code', v_credit_account_code,
        'bank_account_id', case when p_payment_source = 'bank' then p_bank_account_id end,
        'petty_cash_fund_id', case when p_payment_source = 'petty_cash' then p_petty_cash_fund_id end,
        'debit', 0, 'credit', p_amount, 'memo', 'Expense paid'
      )
    )
  );

  return v_expense_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_create_expense_head(p_name text, p_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_parent_id uuid;
  v_new_account_code text;
  v_head_id uuid;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can create an Expense Head.';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Name is required.';
  end if;
  if exists (select 1 from public.expense_heads where lower(name) = lower(trim(p_name))) then
    raise exception 'This Expense Head already exists.';
  end if;

  select id into v_parent_id from public.chart_of_accounts where code = '6000';
  v_new_account_code := public._fn_next_account_code('6000');

  insert into public.chart_of_accounts (code, name, account_type, parent_id, is_system)
  values (v_new_account_code, trim(p_name) || ' Expense', 'expense', v_parent_id, false);

  insert into public.expense_heads (code, name, account_code)
  values (coalesce(nullif(upper(trim(p_code)), ''), upper(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '_', 'g'))), trim(p_name), v_new_account_code)
  returning id into v_head_id;

  return v_head_id;
end;
$function$
;

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

  v_effective_warehouse := coalesce(p_warehouse_id, v_po.warehouse_id);
  if v_po.purchase_type = 'stock' and v_effective_warehouse is null then
    raise exception 'Warehouse is required.';
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
$function$
;

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

    v_qty := (v_line->>'qty')::numeric;
    if v_qty <= 0 then
      raise exception 'Qty must be greater than zero.';
    end if;
    if v_sol.invoiced_qty + v_qty > v_sol.delivered_qty then
      raise exception 'Invoice qty cannot exceed delivered qty (%, deliverable: %).', v_sol.description, v_sol.delivered_qty - v_sol.invoiced_qty;
    end if;

    v_rate := coalesce((v_line->>'rate')::numeric, v_sol.rate);
    v_tax_pct := coalesce((v_line->>'tax_pct')::numeric, v_sol.tax_pct);
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_create_job(p_sales_order_line_id uuid, p_warehouse_id uuid, p_product_template_id uuid, p_description text, p_job_qty numeric, p_responsible_user_id uuid, p_start_date date, p_required_delivery_date date, p_material_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_so_id uuid;
  v_business_line text;
  v_job_id uuid;
  v_job_no text;
  v_line jsonb;
  v_free_qty numeric;
  v_to_reserve numeric;
begin
  if not (public.is_owner() or public.has_role('production')) then
    raise exception 'Only Owner or Production can create a Job.';
  end if;
  if p_job_qty <= 0 then
    raise exception 'Job qty must be greater than zero.';
  end if;

  select sol.sales_order_id, so.business_line into v_so_id, v_business_line
    from public.sales_order_lines sol
    join public.sales_orders so on so.id = sol.sales_order_id
    where sol.id = p_sales_order_line_id;

  if v_so_id is null then
    raise exception 'Sales Order line not found.';
  end if;
  if v_business_line <> 'fabrication' then
    raise exception 'A Job can only be created for a Sales Order in the Fabrication business line.';
  end if;

  select public.fn_get_next_number('JOB') into v_job_no;

  insert into public.jobs
    (job_no, sales_order_id, sales_order_line_id, product_template_id, warehouse_id,
     description, job_qty, responsible_user_id, start_date, required_delivery_date, created_by)
  values
    (v_job_no, v_so_id, p_sales_order_line_id, p_product_template_id, p_warehouse_id,
     p_description, p_job_qty, p_responsible_user_id, p_start_date, p_required_delivery_date, auth.uid())
  returning id into v_job_id;

  if p_product_template_id is not null then
    insert into public.job_material_requirements (job_id, item_id, required_qty, unit, source)
    select v_job_id, ptl.item_id, round(ptl.qty_per_unit * p_job_qty, 3), ptl.unit, 'template'
    from public.product_template_lines ptl
    where ptl.template_id = p_product_template_id;
  else
    if jsonb_array_length(p_material_lines) = 0 then
      raise exception 'Please specify material requirements (or select a template).';
    end if;
    for v_line in select * from jsonb_array_elements(p_material_lines) loop
      insert into public.job_material_requirements (job_id, item_id, required_qty, unit, source)
      values (v_job_id, (v_line->>'item_id')::uuid, (v_line->>'required_qty')::numeric, nullif(v_line->>'unit',''), 'manual');
    end loop;
  end if;

  -- Auto-reserve whatever free stock is available for each requirement
  for v_line in
    select jsonb_build_object('item_id', item_id, 'required_qty', required_qty) from public.job_material_requirements where job_id = v_job_id
  loop
    perform pg_advisory_xact_lock(hashtextextended((v_line->>'item_id') || ':' || p_warehouse_id::text, 0));

    select free_qty into v_free_qty from public.stock_availability
      where item_id = (v_line->>'item_id')::uuid and warehouse_id = p_warehouse_id;
    v_free_qty := coalesce(v_free_qty, 0);
    v_to_reserve := least(v_free_qty, (v_line->>'required_qty')::numeric);
    if v_to_reserve > 0 then
      insert into public.stock_reservations (job_id, item_id, warehouse_id, reserved_qty, reservation_mode, created_by)
      values (v_job_id, (v_line->>'item_id')::uuid, p_warehouse_id, v_to_reserve, 'auto', auth.uid());
      update public.job_material_requirements
        set reserved_qty = reserved_qty + v_to_reserve
        where job_id = v_job_id and item_id = (v_line->>'item_id')::uuid;
    end if;
  end loop;

  perform public._fn_recalc_job_material_status(v_job_id);

  return v_job_id;
end;
$function$
;

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
    v_alloc_total := v_alloc_total + (v_line->>'amount')::numeric;
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
      if (v_line->>'amount')::numeric > v_outstanding then
        raise exception 'Allocation exceeds the outstanding amount (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, invoice_id, amount)
      values (v_payment_id, (v_line->>'invoice_id')::uuid, (v_line->>'amount')::numeric);
    else
      perform pg_advisory_xact_lock(hashtextextended('supplier_bill:' || (v_line->>'supplier_bill_id'), 0));

      select outstanding_amount into v_outstanding from public.supplier_bill_outstanding
        where supplier_bill_id = (v_line->>'supplier_bill_id')::uuid and supplier_id = p_party_id;
      if v_outstanding is null then
        raise exception 'Supplier Bill does not belong to this party or was not found.';
      end if;
      if (v_line->>'amount')::numeric > v_outstanding then
        raise exception 'Allocation exceeds the outstanding amount (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, supplier_bill_id, amount)
      values (v_payment_id, (v_line->>'supplier_bill_id')::uuid, (v_line->>'amount')::numeric);
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_create_petty_cash_fund(p_fund_name text, p_custodian_user_id uuid, p_opening_balance numeric DEFAULT 0, p_opening_balance_date date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can create a Petty Cash Fund.';
  end if;
  if coalesce(trim(p_fund_name), '') = '' then
    raise exception 'Fund name is required.';
  end if;

  insert into public.petty_cash_funds (fund_name, custodian_user_id, created_by)
  values (trim(p_fund_name), p_custodian_user_id, auth.uid())
  returning id into v_id;

  if coalesce(p_opening_balance, 0) <> 0 then
    perform public._fn_post_journal_entry_core(
      coalesce(p_opening_balance_date, current_date), 'Opening Balance — ' || trim(p_fund_name), 'petty_cash_funds', v_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '1060', 'petty_cash_fund_id', v_id, 'debit', greatest(p_opening_balance, 0), 'credit', greatest(-p_opening_balance, 0), 'memo', 'Opening Balance'),
        jsonb_build_object('account_code', '1900', 'debit', greatest(-p_opening_balance, 0), 'credit', greatest(p_opening_balance, 0), 'memo', 'Opening Balance Equity')
      )
    );
  end if;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_create_product_template(p_template_code text, p_name text, p_description text, p_output_item_id uuid, p_output_unit text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_line jsonb;
  v_idx int := 0;
begin
  if not (public.is_owner() or public.has_role('production')) then
    raise exception 'Only Owner or Production can create a template.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Template must have at least one raw material line.';
  end if;

  insert into public.product_templates (template_code, name, description, output_item_id, output_unit, created_by)
  values (p_template_code, p_name, p_description, p_output_item_id, p_output_unit, auth.uid())
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.product_template_lines (template_id, item_id, qty_per_unit, unit, sort_order)
    values (v_id, (v_line->>'item_id')::uuid, (v_line->>'qty_per_unit')::numeric, nullif(v_line->>'unit',''), v_idx);
    v_idx := v_idx + 1;
  end loop;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_create_purchase_order(p_supplier_id uuid, p_purchase_type text, p_linked_sales_order_id uuid, p_warehouse_id uuid, p_expected_delivery date, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_po_id uuid;
  v_po_no text;
  v_line jsonb;
  v_idx int := 0;
begin
  if not (public.is_owner() or public.has_role('store')) then
    raise exception 'Only Owner or Store can create a Purchase Order.';
  end if;
  if p_purchase_type not in ('direct','stock','general') then
    raise exception 'Purchase type is invalid.';
  end if;
  if p_purchase_type = 'direct' and p_linked_sales_order_id is null then
    raise exception 'A direct purchase must be linked to a Sales Order.';
  end if;
  if p_purchase_type = 'stock' and p_warehouse_id is null then
    raise exception 'Warehouse is required for a stock purchase.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Purchase Order must have at least one line.';
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
$function$
;
