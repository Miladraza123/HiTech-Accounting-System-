-- Phase 51 (part 1) — two Owner-reported accounting bugs, fixed surgically.
--
-- A-1: fabrication Jobs post material into WIP (Dr 1320 / Cr 1310) via
-- fn_issue_job_material, but nothing ever released 1320 back out on a
-- normal delivery — only cancel-with-disposition and material-return did.
-- So a delivered Job's cost sat stranded in WIP forever instead of hitting
-- COGS. Fixed by releasing each delivered Job's accumulated material WIP
-- into COGS at the exact point fn_create_delivery_challan already marks
-- that Job 'Delivered'.
--
-- A-3a: fn_create_quotation_revision unconditionally reset the parent
-- Quotation's status back to 'Draft' on every revision — including when
-- the Quotation was already 'Accepted' (meaning a real Sales Order already
-- exists off it). Fixed to skip the reset once Accepted.

create or replace function public.fn_create_quotation_revision(
  p_quotation_id uuid,
  p_reason text,
  p_terms text,
  p_validity_date date,
  p_delivery_terms text,
  p_payment_terms text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- A-3a fix: an Accepted Quotation already has a Sales Order off it —
  -- revising it must not silently flip it back to Draft.
  update public.quotations set status = 'Draft' where id = p_quotation_id and status <> 'Accepted';

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', v_query_id, 'system',
    'Quotation ' || v_quotation_no || ' Rev-' || v_next_rev || ' was created. Reason: ' || coalesce(p_reason, '-'),
    auth.uid());

  return v_revision_id;
end;
$function$;

create or replace function public.fn_create_delivery_challan(
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
set search_path to 'public'
as $function$
declare
  v_so record;
  v_sol record;
  v_dc_id uuid;
  v_dc_no text;
  v_line jsonb;
  v_qty numeric;
  v_stock_qty numeric;
  v_base_unit text;
  v_factor numeric;
  v_issue boolean;
  v_avg_cost numeric;
  v_value numeric;
  v_stock_value_total numeric := 0;
  v_cogs_account text;
  v_all_delivered boolean;
  v_any_delivered boolean;
  v_job record;
  v_job_wip numeric;
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
    v_stock_qty := null;
    if v_sol.item_id is not null then
      select i.base_unit into v_base_unit from public.items i where i.id = v_sol.item_id;
      if v_sol.unit is null or v_sol.unit = v_base_unit then
        v_stock_qty := v_qty;
      else
        select a.factor into v_factor from public.item_alt_units a
          where a.item_id = v_sol.item_id and a.unit = v_sol.unit and a.is_active;
        if v_factor is not null then
          v_stock_qty := round(v_qty * v_factor, 3);
        end if;
      end if;
    end if;
    if v_issue and v_sol.item_id is null then
      raise exception 'An item is required to issue from stock.';
    end if;
    if v_issue and v_stock_qty is null then
      raise exception 'No conversion factor is set from unit % to the item''s base unit % (%) — add it under Alternate Units in the Item Master, or do not issue from stock.', v_sol.unit, v_base_unit, v_sol.description;
    end if;
    v_stock_qty := coalesce(v_stock_qty, v_qty);
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
        order by seq desc limit 1;
      v_avg_cost := coalesce(v_avg_cost, 0);
      perform public._fn_post_stock_ledger(v_sol.item_id, p_warehouse_id, 'DC', -v_stock_qty, v_avg_cost, 'delivery_challans', v_dc_id, 'Delivered via ' || v_dc_no);
      v_value := round(v_stock_qty * v_avg_cost, 2);
      v_stock_value_total := v_stock_value_total + v_value;
    end if;

    -- Advance any linked fabrication Job to Delivered once its SO line is fully delivered
    if v_sol.delivered_qty + v_qty >= v_sol.ordered_qty then
      for v_job in select * from public.jobs where sales_order_line_id = v_sol.id and status = 'ReadyForDispatch' loop
        update public.jobs set status = 'Delivered', progress_pct = 100 where id = v_job.id;

        -- A-1 fix: release this Job's accumulated material WIP (1320) into
        -- COGS now that it's actually delivered — previously this only
        -- happened on cancellation or material return, never on a normal
        -- delivery, leaving delivered Jobs' cost stranded in WIP forever.
        select coalesce(sum(amount), 0) into v_job_wip
          from public.job_cost_ledger where job_id = v_job.id and cost_type = 'material';
        if v_job_wip <> 0 then
          perform public._fn_post_journal_entry_core(
            coalesce(p_delivery_date, current_date), 'Job ' || v_job.job_no || ' delivered — WIP released to COGS',
            'jobs', v_job.id,
            case when v_job_wip > 0 then
              jsonb_build_array(
                jsonb_build_object('account_code', v_cogs_account, 'party_id', null, 'debit', v_job_wip, 'credit', 0, 'memo', 'Cost of Goods Delivered — ' || v_job.job_no),
                jsonb_build_object('account_code', '1320', 'party_id', null, 'debit', 0, 'credit', v_job_wip, 'memo', 'Work-in-Progress released'))
            else
              jsonb_build_array(
                jsonb_build_object('account_code', '1320', 'party_id', null, 'debit', -v_job_wip, 'credit', 0, 'memo', 'Work-in-Progress released'),
                jsonb_build_object('account_code', v_cogs_account, 'party_id', null, 'debit', 0, 'credit', -v_job_wip, 'memo', 'Cost of Goods Delivered — ' || v_job.job_no))
            end
          );
        end if;
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
