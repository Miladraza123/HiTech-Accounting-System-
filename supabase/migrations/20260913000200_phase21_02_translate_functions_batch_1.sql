-- Phase 21.02: Translate Roman-Urdu user-facing exception/notice messages to
-- professional English inside the following PL/pgSQL functions. This migration
-- makes NO logic changes whatsoever — only the text inside `raise exception`,
-- `raise notice`, and `raise warning` string literals is translated. Function
-- signatures, control flow, SQL statements, and comments are unchanged.
--
-- Functions touched:
--   fn_amend_sales_order, fn_approve_stock_adjustment, fn_cancel_contra_entry,
--   fn_cancel_delivery_challan, fn_cancel_expense, fn_cancel_invoice,
--   fn_cancel_job, fn_cancel_payment, fn_cancel_purchase_order,
--   fn_cancel_purchase_return

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
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can amend.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason for the amendment is required.';
  end if;

  perform 1 from public.sales_orders where id = p_sales_order_id for update;
  if not found then
    raise exception 'Sales Order not found.';
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
    where sales_order_id = p_sales_order_id and delivered_qty > 0
      and (v_kept_ids is null or not (id = any(v_kept_ids)))
  ) then
    raise exception 'A line that has already been delivered cannot be removed — only qty/rate can be changed.';
  end if;

  delete from public.sales_order_lines
  where sales_order_id = p_sales_order_id
    and (v_kept_ids is null or not (id = any(v_kept_ids)));

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if (v_line ? 'id') and v_line->>'id' <> '' then
      update public.sales_order_lines set
        item_id = nullif(v_line->>'item_id','')::uuid,
        description = v_line->>'description',
        ordered_qty = (v_line->>'ordered_qty')::numeric,
        unit = nullif(v_line->>'unit',''),
        rate = (v_line->>'rate')::numeric,
        tax_pct = coalesce((v_line->>'tax_pct')::numeric, 0),
        sort_order = v_idx
      where id = (v_line->>'id')::uuid;
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

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  select 'queries', so.query_id, 'system',
         'Sales Order ' || so.so_no || ' amend hui (Rev-' || v_next_rev || '). Wajah: ' || p_reason, auth.uid()
  from public.sales_orders so where so.id = p_sales_order_id;

  return v_revision_id;
end;
$function$
;

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
    order by created_at desc, id desc limit 1;
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

CREATE OR REPLACE FUNCTION public.fn_cancel_contra_entry(p_transfer_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t record;
  v_from_code text;
  v_to_code text;
begin
  if not public.is_owner() then
    raise exception 'Only Owner can cancel Transfers.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason for cancelling is required.';
  end if;

  select * into v_t from public.contra_transfers where id = p_transfer_id for update;
  if v_t.id is null then
    raise exception 'Transfer not found.';
  end if;
  if v_t.status = 'Cancelled' then
    raise exception 'This Transfer is already cancelled.';
  end if;

  v_from_code := case v_t.from_type when 'bank' then '1100' when 'petty_cash' then '1060' else '1050' end;
  v_to_code := case v_t.to_type when 'bank' then '1100' when 'petty_cash' then '1060' else '1050' end;

  perform public._fn_post_journal_entry_core(
    current_date, 'Fund Transfer ' || v_t.transfer_no || ' — cancelled', 'contra_transfers', p_transfer_id,
    jsonb_build_array(
      jsonb_build_object('account_code', v_from_code, 'bank_account_id', v_t.from_bank_account_id, 'petty_cash_fund_id', v_t.from_petty_cash_fund_id, 'debit', v_t.amount, 'credit', 0, 'memo', 'Transfer reversed'),
      jsonb_build_object('account_code', v_to_code, 'bank_account_id', v_t.to_bank_account_id, 'petty_cash_fund_id', v_t.to_petty_cash_fund_id, 'debit', 0, 'credit', v_t.amount, 'memo', 'Transfer reversed')
    )
  );

  update public.contra_transfers set status = 'Cancelled', cancel_reason = p_reason where id = p_transfer_id;
end;
$function$
;

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
        order by created_at desc, id desc limit 1;
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

CREATE OR REPLACE FUNCTION public.fn_cancel_expense(p_expense_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_exp record;
  v_head record;
  v_credit_account_code text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can cancel Expenses.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason for cancelling is required.';
  end if;

  select * into v_exp from public.expenses where id = p_expense_id for update;
  if v_exp.id is null then
    raise exception 'Expense not found.';
  end if;
  if v_exp.status = 'Cancelled' then
    raise exception 'This Expense is already cancelled.';
  end if;

  select * into v_head from public.expense_heads where id = v_exp.expense_head_id;
  v_credit_account_code := case v_exp.payment_source when 'bank' then '1100' when 'petty_cash' then '1060' else '1050' end;

  perform public._fn_post_journal_entry_core(
    current_date, 'Expense ' || v_exp.expense_no || ' — cancelled', 'expenses', p_expense_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_code', v_credit_account_code,
        'bank_account_id', v_exp.bank_account_id, 'petty_cash_fund_id', v_exp.petty_cash_fund_id,
        'debit', v_exp.amount, 'credit', 0, 'memo', 'Expense reversed'
      ),
      jsonb_build_object('account_code', v_head.account_code, 'debit', 0, 'credit', v_exp.amount, 'memo', v_head.name || ' — reversed')
    )
  );

  update public.expenses set status = 'Cancelled', cancel_reason = p_reason where id = p_expense_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_cancel_invoice(p_invoice_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inv record;
  v_so record;
  v_line record;
  v_revenue_account text;
  v_lines jsonb := '[]'::jsonb;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can cancel Invoices.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason for cancelling is required.';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if v_inv.id is null then
    raise exception 'Invoice not found.';
  end if;
  if v_inv.status = 'Cancelled' then
    raise exception 'This Invoice is already cancelled.';
  end if;
  if exists (
    select 1 from public.payment_allocations pa join public.payments p on p.id = pa.payment_id
    where pa.invoice_id = p_invoice_id and p.status = 'Posted'
  ) then
    raise exception 'A payment has already been allocated to this Invoice — cancel the payment first.';
  end if;
  if exists (select 1 from public.sales_returns where invoice_id = p_invoice_id and status = 'Posted') then
    raise exception 'A Sales Return has already been made against this Invoice — cancel the Sales Return first.';
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_cancel_job(p_job_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
begin
  if not (public.is_owner() or public.has_role('production')) then
    raise exception 'Only Owner or Production can cancel.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason for cancelling is required.';
  end if;

  select status into v_status from public.jobs where id = p_job_id;
  if v_status is null then
    raise exception 'Job not found.';
  end if;
  if v_status in ('ReadyForDispatch','Delivered','Cancelled') then
    raise exception 'This Job cannot be cancelled at this stage (%).', v_status;
  end if;
  if exists (select 1 from public.job_material_requirements where job_id = p_job_id and issued_qty > returned_qty) then
    raise exception 'A Job whose material has been issued (and not returned) cannot be cancelled — return the material first.';
  end if;

  update public.stock_reservations set status = 'Released' where job_id = p_job_id and status = 'Active';
  update public.job_material_requirements set reserved_qty = 0 where job_id = p_job_id;

  update public.jobs set status = 'Cancelled', cancel_reason = p_reason where id = p_job_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_cancel_payment(p_payment_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_payment record;
  v_lines jsonb;
  v_cash_account_code text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can cancel Payments.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason for cancelling is required.';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment.id is null then
    raise exception 'Payment not found.';
  end if;
  if v_payment.status = 'Cancelled' then
    raise exception 'This Payment is already cancelled.';
  end if;

  v_cash_account_code := case
    when v_payment.petty_cash_fund_id is not null then '1060'
    when v_payment.bank_account_id is not null then '1100'
    when v_payment.method ilike 'cash' then '1050'
    else '1050'
  end;

  if v_payment.direction = 'receipt' then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '1200', 'party_id', v_payment.party_id, 'debit', v_payment.amount, 'credit', 0, 'memo', 'Trade Receivables — reversed'),
      jsonb_build_object('account_code', v_cash_account_code, 'bank_account_id', v_payment.bank_account_id, 'petty_cash_fund_id', v_payment.petty_cash_fund_id, 'debit', 0, 'credit', v_payment.amount, 'memo', 'Cash/Bank — reversed')
    );
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', v_cash_account_code, 'bank_account_id', v_payment.bank_account_id, 'petty_cash_fund_id', v_payment.petty_cash_fund_id, 'debit', v_payment.amount, 'credit', 0, 'memo', 'Cash/Bank — reversed'),
      jsonb_build_object('account_code', '2100', 'party_id', v_payment.party_id, 'debit', 0, 'credit', v_payment.amount, 'memo', 'Trade Payables — reversed')
    );
  end if;

  perform public._fn_post_journal_entry_core(
    current_date,
    (case when v_payment.direction = 'receipt' then 'Receipt ' else 'Payment ' end) || v_payment.payment_no || ' — cancelled',
    'payments', p_payment_id, v_lines
  );

  update public.payments set status = 'Cancelled', cancel_reason = p_reason where id = p_payment_id;
end;
$function$
;

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

CREATE OR REPLACE FUNCTION public.fn_cancel_purchase_return(p_return_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ret record;
  v_line record;
  v_lines jsonb := '[]'::jsonb;
begin
  if not (public.is_owner() or public.has_role('accounts') or public.has_role('store')) then
    raise exception 'Only Owner, Accounts, or Store can cancel Purchase Returns.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason for cancelling is required.';
  end if;

  select * into v_ret from public.purchase_returns where id = p_return_id for update;
  if v_ret.id is null then
    raise exception 'Purchase Return not found.';
  end if;
  if v_ret.status = 'Cancelled' then
    raise exception 'This Purchase Return is already cancelled.';
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
$function$
;
