-- Phase 29.04 — Master Offline-First Roadmap, Phase 4: offline-first
-- CREATE for Delivery Challan (the app's first offline create that
-- DEDUCTS stock, not just adds it) and Invoice.
--
-- Same idempotent-create pattern as Phases 1-3: client-generated UUID,
-- safe to call twice with the same id.
--
-- Delivery Challan — confirmed by reading the actual function bodies, not
-- assumed:
--   - "can't deliver more than ordered" is re-validated against LIVE
--     `sales_order_lines.delivered_qty` (re-read under `for update` at
--     call time), never a stale offline snapshot.
--   - The actual stock DEDUCTION goes through the exact same
--     `_fn_post_stock_ledger` used for GRN, which takes a
--     `pg_advisory_xact_lock` keyed by item+warehouse and explicitly
--     `raise exception`s if the resulting balance would go negative
--     (confirmed directly in phase3_03_stock_ledger_engine.sql). So a
--     queued offline Delivery Challan that would over-deliver against
--     stock someone else already used up while this device was offline
--     is correctly, authoritatively REJECTED at sync time — not silently
--     allowed to go negative, and not blindly retried forever either
--     (no PG error code on this raise -> the client's own retry
--     classifier already treats it as permanent, surfaced to the user to
--     resolve manually, exactly as the roadmap's "never blindly trust a
--     stale offline snapshot" requirement asks for). This required no
--     new validation logic — it already existed for the online path.
--
-- Invoice — same pattern: "can't invoice more than delivered" is
-- re-validated against LIVE `sales_order_lines.invoiced_qty`/
-- `delivered_qty` (re-read under `for update`), never a stale offline
-- snapshot.
--
-- Same reachability constraint as Phases 2-3: each form lives on a page
-- that live-fetches its parent Sales Order and 404s if not found — so
-- neither is reachable offline when its own Sales Order was ALSO created
-- offline and hasn't synced yet.

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
    v_stock_qty := coalesce((v_line->>'stock_qty')::numeric, v_qty);
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
        order by created_at desc, id desc limit 1;
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

revoke execute on function public.fn_create_delivery_challan_idempotent(uuid, uuid, uuid, date, text, text, text, jsonb) from public, anon;
grant execute on function public.fn_create_delivery_challan_idempotent(uuid, uuid, uuid, date, text, text, text, jsonb) to authenticated;


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

    v_qty := (v_line->>'qty')::numeric;
    if v_qty <= 0 then
      raise exception 'Qty must be greater than zero.';
    end if;
    if v_sol.invoiced_qty + v_qty > v_sol.delivered_qty then
      raise exception 'Invoice qty cannot exceed delivered qty (%, invoiceable: %).', v_sol.description, v_sol.delivered_qty - v_sol.invoiced_qty;
    end if;

    v_rate := coalesce((v_line->>'rate')::numeric, v_sol.rate);
    v_tax_pct := coalesce((v_line->>'tax_pct')::numeric, v_sol.tax_pct);
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

revoke execute on function public.fn_create_invoice_idempotent(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.fn_create_invoice_idempotent(uuid, uuid, date, jsonb) to authenticated;
