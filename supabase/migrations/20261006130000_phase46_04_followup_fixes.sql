-- Phase 46.04 — Follow-up business-rule fixes (found in live testing)
--
-- Same conventions as 20261006110000_phase46_02_business_rule_fixes.sql:
-- every function below is re-created from its LATEST definition (named in
-- each block), with signature, LANGUAGE, SECURITY, search_path unchanged, so
-- CREATE OR REPLACE keeps the existing grants; the revoke/grant lines from
-- the original migrations are re-applied anyway where they existed. No RLS
-- policy, is_owner / has_role or snapshot changes.
--
--   1. dispatch_go_aheads.status        + 'Cancelled'
--      fn_cancel_delivery_challan       closes open go-aheads, marks their unread notifications read
--   2. fn_cancel_service_delivery       refuse while a non-cancelled service invoice exists
--   3. fn_return_job_material(_idem)    refuse on ReadyForDispatch / Delivered / Cancelled jobs
--   4. fn_cancel_sales_order            refuse while the SO has a non-cancelled Job
--   5. fn_create_job(_idempotent)       job qty on a SO line cannot exceed the line's ordered_qty
--   6. fn_import_opening_stock          advisory lock + one OpeningStock per item/warehouse
--   7. fn_cancel_stock_transfer         reversal out-row carries the transfer rate (was 0)
--      fn_cancel_sales_return           reversal out-row carries the SRN rate (was 0)
--   9. _fn_post_journal_entry_core      bank tag only on 1100, petty-cash tag only on 1060, never both
--  10. fn_cancel_expense / fn_cancel_contra_entry  stamp updated_by; expense cancel rolls back the vehicle meter

-- ===========================================================================
-- 1. Cancelling a Delivery Challan closes its open Dispatch Go-Aheads
-- ===========================================================================
-- A go-ahead left Pending/Accepted on a cancelled DC kept showing in the
-- dispatch person's list and in the Reports "open go-aheads" count, and
-- its notification stayed unread. There was no terminal status for "the
-- DC went away", so add 'Cancelled' to the CHECK (Pending / Accepted /
-- Completed keep their meaning).
alter table public.dispatch_go_aheads drop constraint if exists dispatch_go_aheads_status_check;
alter table public.dispatch_go_aheads add constraint dispatch_go_aheads_status_check
  check (status in ('Pending', 'Accepted', 'Completed', 'Cancelled'));

-- fn_cancel_delivery_challan
--
-- Latest definition: 20261006110000_phase46_02_business_rule_fixes.sql
-- Only change: after the DC is marked Cancelled, every Pending/Accepted
-- go-ahead for it becomes Cancelled, and the still-unread notifications that
-- point at this DC (fn_create/accept/complete_dispatch_go_ahead all write
-- related_table = 'delivery_challans', related_id = the DC id) — or at one
-- of its go-aheads — are marked read.
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
        order by seq desc limit 1;
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

  -- Phase 46.04: close open dispatch go-aheads and their unread notifications.
  update public.notifications n
    set is_read = true
    where n.is_read = false
      and (
        (n.related_table = 'delivery_challans' and n.related_id = p_dc_id)
        or (n.related_table = 'dispatch_go_aheads' and n.related_id in (
              select g.id from public.dispatch_go_aheads g where g.delivery_challan_id = p_dc_id))
      );

  update public.dispatch_go_aheads
    set status = 'Cancelled'
    where delivery_challan_id = p_dc_id and status in ('Pending', 'Accepted');
end;
$function$
;
revoke execute on function public.fn_cancel_delivery_challan(uuid, text) from public, anon;
grant execute on function public.fn_cancel_delivery_challan(uuid, text) to authenticated;


-- ===========================================================================
-- 2. fn_cancel_service_delivery — cancel the service invoice first
-- ===========================================================================
-- Mirrors the sales rule (a DC cannot be cancelled once its Sales Order is
-- invoiced): cancelling the delivery of an invoiced service job moved the
-- job back to Completed while the invoice stayed Posted.

-- fn_cancel_service_delivery
--
-- Latest definition: 20261003121000_phase40_02_service_repair_functions.sql

create or replace function public.fn_cancel_service_delivery(p_service_delivery_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery record;
begin
  if not (public.is_owner() or public.has_role('dispatch')) then
    raise exception 'Sirf Owner ya Dispatch Service Delivery cancel kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancel karne ki wajah likhna zaroori hai.';
  end if;

  select * into v_delivery from public.service_deliveries where id = p_service_delivery_id for update;
  if v_delivery.id is null then
    raise exception 'Service Delivery nahi mili.';
  end if;
  if v_delivery.status = 'Cancelled' then
    raise exception 'Yeh Service Delivery pehle se cancel hai.';
  end if;
  -- Phase 46.04: an invoiced service job's delivery cannot be cancelled.
  if exists (
    select 1 from public.service_invoices si
    where si.service_job_id = v_delivery.service_job_id and si.status <> 'Cancelled'
  ) then
    raise exception 'This service job has already been invoiced — cancel the service invoice first, then cancel the delivery.';
  end if;

  update public.service_deliveries set status = 'Cancelled', cancel_reason = p_reason where id = p_service_delivery_id;
  -- The job goes back to "Completed" (ready to deliver again) only if it
  -- was this delivery that most recently moved it to "Delivered" — a
  -- second still-Issued delivery on the same job keeps it Delivered.
  update public.service_jobs
    set status = 'Completed'
    where id = v_delivery.service_job_id
      and status = 'Delivered'
      and not exists (
        select 1 from public.service_deliveries
        where service_job_id = v_delivery.service_job_id and status = 'Issued' and id <> p_service_delivery_id
      );
end;
$$;
revoke execute on function public.fn_cancel_service_delivery(uuid, text) from public, anon;
grant execute on function public.fn_cancel_service_delivery(uuid, text) to authenticated;


-- ===========================================================================
-- 3. fn_return_job_material(_idempotent) — no returns on finished jobs
-- ===========================================================================
-- Issue / reserve already refuse ReadyForDispatch / Delivered / Cancelled
-- (the jobs.status CHECK has no 'Closed'); return did not, so material could
-- be pulled back out of a job whose cost had already gone to dispatch.
-- fn_cancel_job still requires issued material to be returned BEFORE the
-- cancel, so blocking returns on Cancelled jobs does not strand stock.

-- fn_return_job_material
--
-- Latest definition: 20261006110000_phase46_02_business_rule_fixes.sql

CREATE OR REPLACE FUNCTION public.fn_return_job_material(p_job_id uuid, p_item_id uuid, p_qty numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job record;
  v_avg_cost numeric;
  v_value numeric;
  v_issued numeric;
begin
  if not (public.is_owner() or public.has_role('production') or public.has_role('store')) then
    raise exception 'You do not have permission to return material.';
  end if;
  if p_qty <= 0 then
    raise exception 'Qty must be greater than zero.';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'Job not found.';
  end if;
  -- Phase 46.04: same terminal-status rule as issue / reserve.
  if v_job.status in ('ReadyForDispatch', 'Delivered', 'Cancelled') then
    raise exception 'Material cannot be returned on a Job that is %.', v_job.status;
  end if;

  select issued_qty - returned_qty into v_issued from public.job_material_requirements where job_id = p_job_id and item_id = p_item_id;
  if coalesce(v_issued, 0) < p_qty then
    raise exception 'That much material was not issued (available to return: %).', coalesce(v_issued, 0);
  end if;

  select avg_cost into v_avg_cost from public.stock_ledger
    where item_id = p_item_id and warehouse_id = v_job.warehouse_id
    order by seq desc limit 1;
  v_avg_cost := coalesce(v_avg_cost, 0);

  perform public._fn_post_stock_ledger(p_item_id, v_job.warehouse_id, 'Return', p_qty, v_avg_cost, 'jobs', p_job_id, 'Returned from ' || v_job.job_no);

  update public.job_material_requirements
    set returned_qty = returned_qty + p_qty
    where job_id = p_job_id and item_id = p_item_id;

  v_value := round(p_qty * v_avg_cost, 2);
  if v_value > 0 then
    insert into public.job_cost_ledger (job_id, cost_type, amount, qty, item_id, memo, ref_table, ref_id, created_by)
    values (p_job_id, 'material', -v_value, -p_qty, p_item_id, 'Material returned', 'stock_ledger', p_job_id, auth.uid());

    perform public._fn_post_journal_entry_core(
      current_date, 'Material returned from ' || v_job.job_no, 'jobs', p_job_id,
      jsonb_build_array(
        jsonb_build_object('account_code','1310','debit',v_value,'credit',0,'memo','Raw Material Inventory'),
        jsonb_build_object('account_code','1320','debit',0,'credit',v_value,'memo','Work-in-Progress')
      )
    );
  end if;
end;
$function$
;
revoke execute on function public.fn_return_job_material(uuid, uuid, numeric) from public, anon;
grant execute on function public.fn_return_job_material(uuid, uuid, numeric) to authenticated;


-- fn_return_job_material_idempotent
--
-- Latest definition: 20261006110000_phase46_02_business_rule_fixes.sql

create or replace function public.fn_return_job_material_idempotent(
  p_id uuid,
  p_job_id uuid,
  p_item_id uuid,
  p_qty numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_job record;
  v_avg_cost numeric;
  v_value numeric;
  v_issued numeric;
begin
  if not (public.is_owner() or public.has_role('production') or public.has_role('store')) then
    raise exception 'Only Owner, Production or Store can return material.';
  end if;

  select id into v_existing from public.job_material_events where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_qty <= 0 then
    raise exception 'Qty must be greater than zero.';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'Job not found.';
  end if;
  -- Phase 46.04: same terminal-status rule as issue / reserve.
  if v_job.status in ('ReadyForDispatch', 'Delivered', 'Cancelled') then
    raise exception 'Material cannot be returned on a Job that is %.', v_job.status;
  end if;

  -- Re-validated against LIVE issued_qty/returned_qty at call time (the
  -- row is locked by the `select ... for update` above, on the parent
  -- Job — job_material_requirements itself has no independent row lock
  -- here, matching the original fn_return_job_material exactly), never a
  -- stale offline snapshot.
  select issued_qty - returned_qty into v_issued from public.job_material_requirements where job_id = p_job_id and item_id = p_item_id;
  if coalesce(v_issued, 0) < p_qty then
    raise exception 'That much material was never issued (available to return: %).', coalesce(v_issued, 0);
  end if;

  insert into public.job_material_events (id, job_id, item_id, event_type, qty, created_by)
  values (p_id, p_job_id, p_item_id, 'return', p_qty, auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.job_material_events where id = p_id;
    return v_existing;
  end if;

  select avg_cost into v_avg_cost from public.stock_ledger
    where item_id = p_item_id and warehouse_id = v_job.warehouse_id
    order by seq desc limit 1;
  v_avg_cost := coalesce(v_avg_cost, 0);

  perform public._fn_post_stock_ledger(p_item_id, v_job.warehouse_id, 'Return', p_qty, v_avg_cost, 'jobs', p_job_id, 'Returned from ' || v_job.job_no);

  update public.job_material_requirements
    set returned_qty = returned_qty + p_qty
    where job_id = p_job_id and item_id = p_item_id;

  v_value := round(p_qty * v_avg_cost, 2);
  if v_value > 0 then
    insert into public.job_cost_ledger (job_id, cost_type, amount, qty, item_id, memo, ref_table, ref_id, created_by)
    values (p_job_id, 'material', -v_value, -p_qty, p_item_id, 'Material returned', 'job_material_events', p_id, auth.uid());

    perform public._fn_post_journal_entry_core(
      current_date, 'Material returned from ' || v_job.job_no, 'job_material_events', p_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '1310', 'debit', v_value, 'credit', 0, 'memo', 'Raw Material Inventory'),
        jsonb_build_object('account_code', '1320', 'debit', 0, 'credit', v_value, 'memo', 'Work-in-Progress')
      )
    );
  end if;

  return p_id;
end;
$$;
revoke execute on function public.fn_return_job_material_idempotent(uuid, uuid, uuid, numeric) from public, anon;
grant execute on function public.fn_return_job_material_idempotent(uuid, uuid, uuid, numeric) to authenticated;


-- ===========================================================================
-- 4. fn_cancel_sales_order — cancel the Jobs first
-- ===========================================================================
-- A cancelled SO left its fabrication Jobs running (holding reservations,
-- issued material and WIP cost) with nothing to deliver against.

-- fn_cancel_sales_order
--
-- Latest definition: 20261006110000_phase46_02_business_rule_fixes.sql

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

  perform 1 from public.sales_orders where id = p_sales_order_id for update;

  if exists (select 1 from public.delivery_challans d
             where d.sales_order_id = p_sales_order_id and d.status <> 'Cancelled')
     or exists (select 1 from public.invoices i
                where i.sales_order_id = p_sales_order_id and i.status <> 'Cancelled')
     or exists (select 1 from public.sales_order_lines l
                where l.sales_order_id = p_sales_order_id and (l.delivered_qty > 0 or l.invoiced_qty > 0)) then
    raise exception 'This Sales Order has deliveries or invoices — cancel those first, then cancel the Sales Order.';
  end if;

  -- Phase 46.04: every Job on the SO must be cancelled first.
  if exists (select 1 from public.jobs j
             where j.sales_order_id = p_sales_order_id and j.status <> 'Cancelled') then
    raise exception 'This Sales Order has Jobs that are not cancelled — cancel the Jobs first, then cancel the Sales Order.';
  end if;

  update public.sales_orders
    set status = 'Cancelled', cancel_reason = p_reason
    where id = p_sales_order_id and status not in ('Cancelled','Closed')
    returning query_id, so_no into v_query_id, v_so_no;

  if v_query_id is null then
    raise exception 'This Sales Order cannot be cancelled (it may already be Cancelled/Closed).';
  end if;

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', v_query_id, 'status_change', 'Sales Order ' || v_so_no || ' was cancelled. Reason: ' || p_reason, auth.uid());
end;
$function$;
revoke execute on function public.fn_cancel_sales_order(uuid, text) from public, anon;
grant execute on function public.fn_cancel_sales_order(uuid, text) to authenticated;


-- ===========================================================================
-- 5. fn_create_job(_idempotent) — job qty capped by the SO line
-- ===========================================================================
-- Nothing stopped several Jobs (or one oversized Job) from adding up to more
-- than the SO line's ordered_qty. The SO line row is now locked FOR UPDATE so
-- two concurrent creates on the same line serialise on the sum check.

-- fn_create_job
--
-- Latest definition: 20260913000400_phase21_02_translate_functions_batch_3.sql

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
  v_ordered_qty numeric;
  v_jobbed_qty numeric;
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

  -- Phase 46.04: non-cancelled job qty on this line + this job <= ordered qty.
  select ordered_qty into v_ordered_qty from public.sales_order_lines
    where id = p_sales_order_line_id for update;
  select coalesce(sum(job_qty), 0) into v_jobbed_qty from public.jobs
    where sales_order_line_id = p_sales_order_line_id and status <> 'Cancelled';
  if v_jobbed_qty + p_job_qty > v_ordered_qty then
    raise exception 'Job qty exceeds the Sales Order line: ordered %, already in Jobs %, this Job %.',
      v_ordered_qty, v_jobbed_qty, p_job_qty;
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
$function$;
revoke execute on function public.fn_create_job(uuid, uuid, uuid, text, numeric, uuid, date, date, jsonb) from public, anon;
grant execute on function public.fn_create_job(uuid, uuid, uuid, text, numeric, uuid, date, date, jsonb) to authenticated;


-- fn_create_job_idempotent
--
-- Latest definition: 20260914080000_phase29_07_offline_first_fabrication_create.sql
-- The replay short-circuit (existing p_id returns early) stays BEFORE the cap,
-- so a retried offline create of an already-saved Job still succeeds.
create or replace function public.fn_create_job_idempotent(
  p_id uuid,
  p_sales_order_line_id uuid,
  p_warehouse_id uuid,
  p_product_template_id uuid,
  p_description text,
  p_job_qty numeric,
  p_responsible_user_id uuid,
  p_start_date date,
  p_required_delivery_date date,
  p_material_lines jsonb -- [{item_id, required_qty, unit}] — ignored if p_product_template_id is set
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_so_id uuid;
  v_business_line text;
  v_job_no text;
  v_line jsonb;
  v_free_qty numeric;
  v_to_reserve numeric;
  v_ordered_qty numeric;
  v_jobbed_qty numeric;
begin
  if not (public.is_owner() or public.has_role('production')) then
    raise exception 'Only Owner or Production can create a Job.';
  end if;

  select id into v_existing from public.jobs where id = p_id;
  if v_existing is not null then
    return v_existing;
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

  -- Phase 46.04: non-cancelled job qty on this line + this job <= ordered qty.
  select ordered_qty into v_ordered_qty from public.sales_order_lines
    where id = p_sales_order_line_id for update;
  select coalesce(sum(job_qty), 0) into v_jobbed_qty from public.jobs
    where sales_order_line_id = p_sales_order_line_id and status <> 'Cancelled';
  if v_jobbed_qty + p_job_qty > v_ordered_qty then
    raise exception 'Job qty exceeds the Sales Order line: ordered %, already in Jobs %, this Job %.',
      v_ordered_qty, v_jobbed_qty, p_job_qty;
  end if;
  if v_business_line <> 'fabrication' then
    raise exception 'A Job can only be created against a Fabrication business-line Sales Order.';
  end if;

  select public.fn_get_next_number('JOB') into v_job_no;

  insert into public.jobs
    (id, job_no, sales_order_id, sales_order_line_id, product_template_id, warehouse_id,
     description, job_qty, responsible_user_id, start_date, required_delivery_date, created_by)
  values
    (p_id, v_job_no, v_so_id, p_sales_order_line_id, p_product_template_id, p_warehouse_id,
     p_description, p_job_qty, p_responsible_user_id, p_start_date, p_required_delivery_date, auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.jobs where id = p_id;
    return v_existing;
  end if;

  if p_product_template_id is not null then
    insert into public.job_material_requirements (job_id, item_id, required_qty, unit, source)
    select p_id, ptl.item_id, round(ptl.qty_per_unit * p_job_qty, 3), ptl.unit, 'template'
    from public.product_template_lines ptl
    where ptl.template_id = p_product_template_id;
  else
    if jsonb_array_length(p_material_lines) = 0 then
      raise exception 'Provide the material requirement (or select a Template).';
    end if;
    for v_line in select * from jsonb_array_elements(p_material_lines) loop
      insert into public.job_material_requirements (job_id, item_id, required_qty, unit, source)
      values (p_id, (v_line->>'item_id')::uuid, (v_line->>'required_qty')::numeric, nullif(v_line->>'unit', ''), 'manual');
    end loop;
  end if;

  -- Auto-reserve whatever free stock is available for each requirement —
  -- identical to fn_create_job; any shortfall stays visible as
  -- required_qty > reserved_qty.
  for v_line in
    select jsonb_build_object('item_id', item_id, 'required_qty', required_qty) from public.job_material_requirements where job_id = p_id
  loop
    select free_qty into v_free_qty from public.stock_availability
      where item_id = (v_line->>'item_id')::uuid and warehouse_id = p_warehouse_id;
    v_free_qty := coalesce(v_free_qty, 0);
    v_to_reserve := least(v_free_qty, (v_line->>'required_qty')::numeric);
    if v_to_reserve > 0 then
      insert into public.stock_reservations (job_id, item_id, warehouse_id, reserved_qty, reservation_mode, created_by)
      values (p_id, (v_line->>'item_id')::uuid, p_warehouse_id, v_to_reserve, 'auto', auth.uid());
      update public.job_material_requirements
        set reserved_qty = reserved_qty + v_to_reserve
        where job_id = p_id and item_id = (v_line->>'item_id')::uuid;
    end if;
  end loop;

  perform public._fn_recalc_job_material_status(p_id);

  return p_id;
end;
$$;
revoke execute on function public.fn_create_job_idempotent(uuid, uuid, uuid, uuid, text, numeric, uuid, date, date, jsonb) from public, anon;
grant execute on function public.fn_create_job_idempotent(uuid, uuid, uuid, uuid, text, numeric, uuid, date, date, jsonb) to authenticated;


-- ===========================================================================
-- 6. fn_import_opening_stock — one opening balance per item + warehouse
-- ===========================================================================
-- The import wizard already skips rows whose item/warehouse has an
-- OpeningStock ledger row, but two parallel imports (or a direct RPC) could
-- still post it twice. Serialise per item+warehouse and refuse a second one.

-- fn_import_opening_stock
--
-- Latest definition: 20260913000500_phase21_02_translate_functions_batch_4.sql

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

  -- Phase 46.04: DB-level idempotency — at most one OpeningStock row per
  -- item + warehouse, checked under a per-pair transaction lock.
  perform pg_advisory_xact_lock(hashtext('opening_stock:' || v_item_id::text || ':' || v_warehouse_id::text));
  if exists (
    select 1 from public.stock_ledger sl
    where sl.item_id = v_item_id and sl.warehouse_id = v_warehouse_id and sl.txn_type = 'OpeningStock'
  ) then
    raise exception 'Opening stock for item "%" in warehouse "%" has already been imported.', p_item_code, p_warehouse_code;
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
revoke execute on function public.fn_import_opening_stock(text, text, numeric, numeric, date, text, uuid, text) from public, anon;
grant execute on function public.fn_import_opening_stock(text, text, numeric, numeric, date, text, uuid, text) to authenticated;


-- ===========================================================================
-- 7. Reversal out-rows carry the original rate instead of 0
-- ===========================================================================
-- _fn_post_stock_ledger keeps avg_cost unchanged on an out-row, so the 0
-- never corrupted valuation, but the ledger / stock-card showed the reversal
-- at rate 0 (value 0) next to an in-row at the real cost. No grants existed
-- in the source migrations for these two functions; CREATE OR REPLACE keeps
-- whatever they have.

-- fn_cancel_stock_transfer
--
-- Latest definition: 20260913000300_phase21_02_translate_functions_batch_2.sql
-- The destination out-row now uses the line's transfer rate (the source
-- avg cost captured by fn_create_stock_transfer), same as the source in-row.
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
    perform public._fn_post_stock_ledger(v_line.item_id, v_transfer.to_warehouse_id, 'STN', -v_line.qty, v_line.rate, 'stock_transfers', p_transfer_id, 'Transfer ' || v_transfer.transfer_no || ' — cancelled');
    perform public._fn_post_stock_ledger(v_line.item_id, v_transfer.from_warehouse_id, 'STN', v_line.qty, v_line.rate, 'stock_transfers', p_transfer_id, 'Transfer ' || v_transfer.transfer_no || ' — cancelled');
  end loop;

  update public.stock_transfers set status = 'Cancelled', cancel_reason = p_reason where id = p_transfer_id;
end;
$function$;


-- fn_cancel_sales_return
--
-- Latest definition: 20261006110000_phase46_02_business_rule_fixes.sql
-- The out-row now uses the rate of the SRN row the return posted.
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
  v_srn_rate numeric;
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

    -- Phase 46.02: reverse whenever the return actually put this item into
    -- stock (fn_create_sales_return posts an SRN for every line with an item,
    -- even at zero avg cost), not only when stock_value > 0 — otherwise a
    -- zero-cost item's stock stayed inflated after the cancel.
    -- Phase 46.04: carry the SRN rate on the reversal (was hard-coded 0).
    if v_line.item_id is not null then
      select sl.rate into v_srn_rate from public.stock_ledger sl
        where sl.ref_table = 'sales_returns' and sl.ref_id = p_return_id
          and sl.item_id = v_line.item_id and sl.warehouse_id = v_ret.warehouse_id
          and sl.qty > 0
        order by sl.seq
        limit 1;
      if found then
        perform public._fn_post_stock_ledger(v_line.item_id, v_ret.warehouse_id, 'SRN', -v_line.qty, coalesce(v_srn_rate, 0), 'sales_returns', p_return_id, 'Sales Return ' || v_ret.return_no || ' — cancelled');
      end if;
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


-- ===========================================================================
-- 9. _fn_post_journal_entry_core — bank / petty-cash tags on the right account
-- ===========================================================================
-- Latest definition: 20261006100000_phase46_01_security_hardening.sql (the
-- 6-argument overload; the 5-argument wrapper delegates to it and is not
-- touched). The balance views sum every tagged journal line, whatever its
-- account, so a manual JV tagging e.g. an expense line with a bank account
-- made the bank balance disagree with GL 1100. Every system posting already
-- tags only 1100 / 1060 lines (fn_create_payment, fn_create_expense,
-- fn_create_contra_entry and their cancels).
create or replace function public._fn_post_journal_entry_core(p_entry_date date, p_narration text, p_source_table text, p_source_id uuid, p_lines jsonb, p_entry_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_entry_id uuid;
  v_entry_no text;
  v_line jsonb;
  v_account_id uuid;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_lock_date date;
begin
  select period_lock_date into v_lock_date from public.company limit 1;
  if v_lock_date is not null and p_entry_date <= v_lock_date then
    raise exception 'Yeh date (%) locked period mein hai (lock: %). Is date par koi nayi entry post nahi ho sakti.', p_entry_date, v_lock_date;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    -- Phase 46.04: a bank / petty-cash tag only belongs on its own control
    -- account (1100 Bank Accounts / 1060 Petty Cash — the codes every posting
    -- function tags), and a line can carry at most one of them. A tag on any
    -- other account silently moved bank_account_balances /
    -- petty_cash_fund_balances away from the GL.
    if nullif(v_line->>'bank_account_id', '') is not null
       and nullif(v_line->>'petty_cash_fund_id', '') is not null then
      raise exception 'A journal line cannot be tagged with both a bank account and a petty cash fund.';
    end if;
    if nullif(v_line->>'bank_account_id', '') is not null and coalesce(v_line->>'account_code', '') <> '1100' then
      raise exception 'A bank account can only be tagged on a line posted to account 1100 (Bank Accounts), not %.', coalesce(v_line->>'account_code', '(none)');
    end if;
    if nullif(v_line->>'petty_cash_fund_id', '') is not null and coalesce(v_line->>'account_code', '') <> '1060' then
      raise exception 'A petty cash fund can only be tagged on a line posted to account 1060 (Petty Cash), not %.', coalesce(v_line->>'account_code', '(none)');
    end if;
    v_total_debit := v_total_debit + coalesce((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + coalesce((v_line->>'credit')::numeric, 0);
  end loop;
  if round(v_total_debit - v_total_credit, 2) <> 0 then
    raise exception 'Journal entry balanced nahi hai (Debit: %, Credit: %).', v_total_debit, v_total_credit;
  end if;

  select public.fn_get_next_number('JV') into v_entry_no;

  insert into public.journal_entries (id, entry_no, entry_date, narration, source_table, source_id, created_by)
  values (coalesce(p_entry_id, gen_random_uuid()), v_entry_no, p_entry_date, p_narration, p_source_table, p_source_id, auth.uid())
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select id into v_account_id from public.chart_of_accounts where code = v_line->>'account_code';
    if v_account_id is null then
      raise exception 'Unknown chart of accounts code: %', v_line->>'account_code';
    end if;
    insert into public.journal_lines (journal_entry_id, account_id, party_id, bank_account_id, petty_cash_fund_id, debit, credit, memo)
    values (
      v_entry_id,
      v_account_id,
      nullif(v_line->>'party_id','')::uuid,
      nullif(v_line->>'bank_account_id','')::uuid,
      nullif(v_line->>'petty_cash_fund_id','')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      v_line->>'memo'
    );
  end loop;

  return v_entry_id;
end;
$function$;

revoke all on function public._fn_post_journal_entry_core(date, text, text, uuid, jsonb, uuid) from public, anon, authenticated;

-- ===========================================================================
-- 10. fn_cancel_expense / fn_cancel_contra_entry — audit stamp + vehicle meter
-- ===========================================================================
-- trg_updated_at only sets updated_at; updated_by stayed the creator, so the
-- record never showed who cancelled it. fn_create_expense(_idempotent) moves
-- vehicles.current_meter_reading forward to the expense's odometer reading;
-- cancelling that expense left the vehicle at the cancelled reading. It now
-- rolls back to the highest reading on the vehicle's other non-cancelled
-- expenses (never below opening_meter_reading — the table's CHECK), but only
-- while the vehicle still shows exactly this expense's reading.

-- fn_cancel_expense
--
-- Latest definition: 20260913000200_phase21_02_translate_functions_batch_1.sql

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
  v_prev_reading numeric;
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

  update public.expenses
    set status = 'Cancelled', cancel_reason = p_reason, updated_by = auth.uid(), updated_at = now()
    where id = p_expense_id;

  -- Phase 46.04: roll the vehicle meter back if this expense set it.
  if v_exp.vehicle_id is not null and v_exp.odometer_reading is not null then
    perform 1 from public.vehicles where id = v_exp.vehicle_id for update;
    select max(e.odometer_reading) into v_prev_reading
      from public.expenses e
      where e.vehicle_id = v_exp.vehicle_id and e.id <> p_expense_id
        and e.status <> 'Cancelled' and e.odometer_reading is not null;
    update public.vehicles v
      set current_meter_reading = greatest(v.opening_meter_reading, coalesce(v_prev_reading, v.opening_meter_reading)),
          updated_by = auth.uid(), updated_at = now()
      where v.id = v_exp.vehicle_id and v.current_meter_reading = v_exp.odometer_reading;
  end if;
end;
$function$
;


-- fn_cancel_contra_entry
--
-- Latest definition: 20260913000200_phase21_02_translate_functions_batch_1.sql

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

  update public.contra_transfers
    set status = 'Cancelled', cancel_reason = p_reason, updated_by = auth.uid(), updated_at = now()
    where id = p_transfer_id;
end;
$function$
;


-- ===========================================================================
-- 16. vehicle_expense_summary.fuel_expense found fuel only by head code 'FUEL'.
-- ===========================================================================
-- The live fuel head is coded 'FE' (named "FUEL"), so the vehicle page showed
-- 0 fuel. Same rule as NewExpenseForm.tsx now uses: code FUEL/FE or a name
-- containing "fuel". Column list and security_invoker unchanged.
create or replace view public.vehicle_expense_summary with (security_invoker = true) as
select
  v.id as vehicle_id,
  v.vehicle_no,
  v.vehicle_type,
  v.make_model,
  v.status,
  v.assigned_user_id,
  v.opening_meter_reading,
  v.current_meter_reading,
  coalesce(sum(e.amount) filter (where e.status = 'Posted'), 0) as total_expense,
  coalesce(sum(e.amount) filter (where e.status = 'Posted' and e.expense_head_id in (
    select id from public.expense_heads where upper(code) in ('FUEL', 'FE') or name ilike '%fuel%')), 0) as fuel_expense,
  coalesce(sum(e.amount) filter (where e.status = 'Posted' and e.expense_head_id in (select id from public.expense_heads where code in ('REPAIR', 'MAINTENANCE', 'OIL_CHANGE', 'TYRES', 'BATTERY'))), 0) as maintenance_expense
from public.vehicles v
left join public.expenses e on e.vehicle_id = v.id
group by v.id, v.vehicle_no, v.vehicle_type, v.make_model, v.status, v.assigned_user_id, v.opening_meter_reading, v.current_meter_reading;
