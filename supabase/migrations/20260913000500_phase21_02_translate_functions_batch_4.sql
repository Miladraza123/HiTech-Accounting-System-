-- Translates Roman-Urdu user-facing exception/notice messages in these PL/pgSQL
-- functions into professional English. No logic, control flow, SQL, signatures,
-- or non-user-facing strings (e.g. activity_timeline notes, journal memo lines)
-- are changed — only the text inside `raise exception` string literals.
--
-- Functions covered: fn_create_purchase_return, fn_create_quotation,
-- fn_create_quotation_revision, fn_create_sales_order, fn_create_sales_return,
-- fn_create_stock_transfer, fn_create_supplier_bill, fn_create_task,
-- fn_import_opening_stock.

CREATE OR REPLACE FUNCTION public.fn_create_purchase_return(p_supplier_bill_id uuid, p_warehouse_id uuid, p_return_date date, p_reason text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    raise exception 'Only Owner, Accounts, or Store can create a Purchase Return.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason for the return is required.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Return must have at least one line.';
  end if;
  if p_warehouse_id is null then
    raise exception 'Warehouse is required (where the stock will be returned from).';
  end if;

  select * into v_bill from public.supplier_bills where id = p_supplier_bill_id for update;
  if v_bill.id is null then
    raise exception 'Supplier Bill not found.';
  end if;
  if v_bill.status <> 'Posted' then
    raise exception 'Purchase Return can only be created for a Posted Supplier Bill.';
  end if;

  select * into v_po from public.purchase_orders where id = v_bill.purchase_order_id;
  if v_po.id is null or v_po.purchase_type <> 'stock' then
    raise exception 'Purchase Return is only for stock-type purchases (for direct/general GRNs, Accounts Payable was already booked at the time of receiving — use a Journal Voucher for correction).';
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
      raise exception 'Bill line not found.';
    end if;

    v_qty := (v_line->>'qty')::numeric;
    if v_qty <= 0 then
      raise exception 'Return quantity must be greater than zero.';
    end if;
    if v_bl.returned_qty + v_qty > v_bl.qty then
      raise exception 'Return quantity cannot exceed the billed quantity (%, max returnable: %).', v_bl.description, v_bl.qty - v_bl.returned_qty;
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

CREATE OR REPLACE FUNCTION public.fn_create_quotation(p_query_id uuid, p_terms text, p_validity_date date, p_delivery_terms text, p_payment_terms text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_party_id uuid;
  v_quotation_id uuid;
  v_revision_id uuid;
  v_quotation_no text;
  v_totals record;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can create a Quotation.';
  end if;

  select party_id into v_party_id from public.queries where id = p_query_id;
  if v_party_id is null then
    raise exception 'Query not found.';
  end if;

  select public.fn_get_next_number('QTN') into v_quotation_no;

  insert into public.quotations (quotation_no, query_id, party_id, responsible_user_id, status)
  values (v_quotation_no, p_query_id, v_party_id, auth.uid(), 'Draft')
  returning id into v_quotation_id;

  insert into public.quotation_revisions (quotation_id, rev_no, terms, validity_date, delivery_terms, payment_terms, is_current, created_by)
  values (v_quotation_id, 0, p_terms, p_validity_date, p_delivery_terms, p_payment_terms, true, auth.uid())
  returning id into v_revision_id;

  select * into v_totals from public._fn_insert_quotation_lines(v_revision_id, p_lines);

  update public.quotation_revisions
    set subtotal = v_totals.subtotal, tax_total = v_totals.tax_total, grand_total = v_totals.grand_total
    where id = v_revision_id;

  update public.queries set status = 'Quoted' where id = p_query_id and status = 'Open';

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', p_query_id, 'system', 'Quotation ' || v_quotation_no || ' (Rev-0) banai gayi.', auth.uid());

  return v_quotation_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_create_quotation_revision(p_quotation_id uuid, p_reason text, p_terms text, p_validity_date date, p_delivery_terms text, p_payment_terms text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_query_id uuid;
  v_quotation_no text;
  v_next_rev int;
  v_revision_id uuid;
  v_totals record;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can create a Revision.';
  end if;

  select query_id, quotation_no into v_query_id, v_quotation_no
    from public.quotations where id = p_quotation_id for update;
  if v_query_id is null then
    raise exception 'Quotation not found.';
  end if;

  select coalesce(max(rev_no), -1) + 1 into v_next_rev
    from public.quotation_revisions where quotation_id = p_quotation_id;

  update public.quotation_revisions set is_current = false
    where quotation_id = p_quotation_id and is_current;

  insert into public.quotation_revisions
    (quotation_id, rev_no, terms, validity_date, delivery_terms, payment_terms, is_current, reason, created_by)
  values
    (p_quotation_id, v_next_rev, p_terms, p_validity_date, p_delivery_terms, p_payment_terms, true, p_reason, auth.uid())
  returning id into v_revision_id;

  select * into v_totals from public._fn_insert_quotation_lines(v_revision_id, p_lines);

  update public.quotation_revisions
    set subtotal = v_totals.subtotal, tax_total = v_totals.tax_total, grand_total = v_totals.grand_total
    where id = v_revision_id;

  update public.quotations set status = 'Draft' where id = p_quotation_id;

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', v_query_id, 'system',
    'Quotation ' || v_quotation_no || ' Rev-' || v_next_rev || ' banai gayi. Wajah: ' || coalesce(p_reason, '-'),
    auth.uid());

  return v_revision_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_create_sales_order(p_quotation_id uuid, p_client_po_number text, p_po_date date, p_delivery_schedule date, p_payment_terms text, p_business_line text, p_lines jsonb, p_confirm_duplicate boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_query_id uuid;
  v_party_id uuid;
  v_so_id uuid;
  v_so_no text;
  v_line jsonb;
  v_idx int := 0;
  v_dup_count int;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can create a Sales Order.';
  end if;
  if p_business_line not in ('material_supply','fabrication') then
    raise exception 'Specify a business line: material_supply or fabrication.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Sales Order must have at least one line.';
  end if;

  select query_id, party_id into v_query_id, v_party_id from public.quotations where id = p_quotation_id;
  if v_party_id is null then
    raise exception 'Quotation not found.';
  end if;

  select count(*) into v_dup_count
    from public.sales_orders
    where party_id = v_party_id and client_po_number = p_client_po_number;

  if v_dup_count > 0 and not p_confirm_duplicate then
    raise exception 'DUPLICATE_PO';
  end if;

  select public.fn_get_next_number('SO') into v_so_no;

  insert into public.sales_orders
    (so_no, quotation_id, query_id, party_id, client_po_number, po_date, delivery_schedule,
     payment_terms, business_line, responsible_user_id, created_by)
  values
    (v_so_no, p_quotation_id, v_query_id, v_party_id, p_client_po_number, p_po_date, p_delivery_schedule,
     p_payment_terms, p_business_line, auth.uid(), auth.uid())
  returning id into v_so_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.sales_order_lines (sales_order_id, item_id, description, ordered_qty, unit, rate, tax_pct, sort_order)
    values (
      v_so_id,
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

  perform public._fn_recalc_so_totals(v_so_id);

  update public.quotations set status = 'Accepted' where id = p_quotation_id and status in ('Draft','Sent');
  update public.queries set status = 'Won' where id = v_query_id;

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', v_query_id, 'system', 'Sales Order ' || v_so_no || ' bani (Client PO: ' || p_client_po_number || ').', auth.uid());

  return v_so_id;
end;
$function$;

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
      order by created_at desc, id desc limit 1;
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

CREATE OR REPLACE FUNCTION public.fn_create_supplier_bill(p_grn_id uuid, p_bill_date date, p_supplier_bill_ref text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_grn record;
  v_po record;
  v_gl record;
  v_bill_id uuid;
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

  select * into v_grn from public.grns where id = p_grn_id for update;
  if v_grn.id is null then
    raise exception 'GRN not found.';
  end if;

  select * into v_po from public.purchase_orders where id = v_grn.purchase_order_id;
  if v_po.purchase_type <> 'stock' then
    raise exception 'Trade Payables for this GRN were already booked at the time of receiving — a separate Supplier Bill is not required.';
  end if;

  if exists (select 1 from public.supplier_bills where grn_id = p_grn_id and status <> 'Cancelled') then
    raise exception 'A Supplier Bill already exists for this GRN.';
  end if;

  select public.fn_get_next_number('BILL') into v_bill_no;

  insert into public.supplier_bills
    (bill_no, supplier_id, purchase_order_id, grn_id, bill_date, supplier_bill_ref, created_by)
  values
    (v_bill_no, v_grn.supplier_id, v_grn.purchase_order_id, p_grn_id, coalesce(p_bill_date, current_date), p_supplier_bill_ref, auth.uid())
  returning id into v_bill_id;

  for v_gl in select * from public.grn_lines where grn_id = p_grn_id loop
    v_line_count := v_line_count + 1;
    v_amount := round(v_gl.this_receipt_qty * v_gl.rate, 2);

    insert into public.supplier_bill_lines
      (supplier_bill_id, grn_line_id, item_id, description, qty, rate, tax_pct, sort_order)
    values
      (v_bill_id, v_gl.id, v_gl.item_id, coalesce((select description from public.items where id = v_gl.item_id), 'Item'), v_gl.this_receipt_qty, v_gl.rate, v_gl.tax_pct, v_line_count);

    v_subtotal := v_subtotal + v_amount;
    v_tax_total := v_tax_total + round(v_amount * v_gl.tax_pct / 100, 2);
  end loop;

  if v_line_count = 0 then
    raise exception 'No lines found for this GRN.';
  end if;

  update public.supplier_bills
    set subtotal = round(v_subtotal, 2), tax_total = round(v_tax_total, 2), grand_total = round(v_subtotal + v_tax_total, 2)
    where id = v_bill_id;

  v_lines := v_lines || jsonb_build_object('account_code', '1330', 'party_id', v_grn.supplier_id, 'debit', round(v_subtotal, 2), 'credit', 0, 'memo', 'GRN Clearing');
  if v_tax_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1400', 'party_id', null, 'debit', round(v_tax_total, 2), 'credit', 0, 'memo', 'Input Sales Tax');
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', '2100', 'party_id', v_grn.supplier_id, 'debit', 0, 'credit', round(v_subtotal + v_tax_total, 2), 'memo', 'Trade Payables');

  perform public._fn_post_journal_entry_core(coalesce(p_bill_date, current_date), 'Supplier Bill ' || v_bill_no, 'supplier_bills', v_bill_id, v_lines);

  return v_bill_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_create_task(p_title text, p_assigned_to uuid, p_description text DEFAULT NULL::text, p_due_date date DEFAULT NULL::date, p_priority text DEFAULT 'Medium'::text, p_related_table text DEFAULT NULL::text, p_related_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_task_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Task title is required.';
  end if;
  if p_priority not in ('Low','Medium','High') then
    raise exception 'Priority must be Low, Medium, or High.';
  end if;
  if not exists (select 1 from public.profiles where id = p_assigned_to) then
    raise exception 'Assigned user not found.';
  end if;

  insert into public.tasks (title, description, related_table, related_id, assigned_to, priority, due_date, created_by)
  values (trim(p_title), p_description, p_related_table, p_related_id, p_assigned_to, p_priority, p_due_date, auth.uid())
  returning id into v_task_id;

  return v_task_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_import_opening_stock(p_item_code text, p_warehouse_code text, p_qty numeric, p_rate numeric, p_as_of_date date, p_ref_table text, p_ref_id uuid, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item_id uuid;
  v_item_stocked boolean;
  v_warehouse_id uuid;
  v_ledger_id uuid;
  v_value numeric;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can import Opening Stock.';
  end if;
  if p_qty <= 0 then
    raise exception 'Quantity must be greater than zero.';
  end if;
  if p_rate < 0 then
    raise exception 'Rate cannot be negative.';
  end if;

  select id, is_stocked into v_item_id, v_item_stocked from public.items where item_code = p_item_code;
  if v_item_id is null then
    raise exception 'Item code "%" not found.', p_item_code;
  end if;
  if not v_item_stocked then
    raise exception 'Item "%" is not stocked (is_stocked = false) — cannot import into the stock ledger.', p_item_code;
  end if;

  select id into v_warehouse_id from public.warehouses where code = p_warehouse_code;
  if v_warehouse_id is null then
    raise exception 'Warehouse code "%" not found.', p_warehouse_code;
  end if;

  v_ledger_id := public._fn_post_stock_ledger(
    v_item_id, v_warehouse_id, 'OpeningStock', p_qty, p_rate, p_ref_table, p_ref_id, coalesce(p_notes, 'Opening stock')
  );

  v_value := round(p_qty * p_rate, 2);
  if v_value > 0 then
    perform public._fn_post_journal_entry_core(
      coalesce(p_as_of_date, current_date), coalesce(p_notes, 'Opening stock — ' || p_item_code), p_ref_table, p_ref_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '1310', 'party_id', null, 'debit', v_value, 'credit', 0, 'memo', 'Raw Material Inventory — opening'),
        jsonb_build_object('account_code', '1900', 'party_id', null, 'debit', 0, 'credit', v_value, 'memo', 'Opening Balance Equity')
      )
    );
  end if;

  return v_ledger_id;
end;
$function$;
