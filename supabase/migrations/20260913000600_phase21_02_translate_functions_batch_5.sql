-- Translates Roman-Urdu user-facing exception messages in the functions below to
-- professional English. No logic, control flow, SQL, or signatures are changed;
-- only the text inside `raise exception` string literals is translated.

CREATE OR REPLACE FUNCTION public.fn_issue_job_material(p_job_id uuid, p_item_id uuid, p_qty numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job record;
  v_avg_cost numeric;
  v_value numeric;
  v_to_consume numeric;
  v_res record;
  v_had_issue boolean;
begin
  if not (public.is_owner() or public.has_role('production') or public.has_role('store')) then
    raise exception 'You do not have permission to issue material.';
  end if;
  if p_qty <= 0 then
    raise exception 'Qty must be greater than zero.';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'Job not found.';
  end if;
  if v_job.status in ('ReadyForDispatch','Delivered','Cancelled') then
    raise exception 'Material cannot be issued at this stage (%).', v_job.status;
  end if;

  select (issued_qty > 0) into v_had_issue from public.job_material_requirements where job_id = p_job_id and item_id = p_item_id;

  select avg_cost into v_avg_cost from public.stock_ledger
    where item_id = p_item_id and warehouse_id = v_job.warehouse_id
    order by created_at desc, id desc limit 1;
  v_avg_cost := coalesce(v_avg_cost, 0);

  perform public._fn_post_stock_ledger(p_item_id, v_job.warehouse_id, 'Issue', -p_qty, v_avg_cost, 'jobs', p_job_id, 'Issued to ' || v_job.job_no);

  -- Consume active reservations for this job+item, oldest first, up to p_qty
  v_to_consume := p_qty;
  for v_res in
    select * from public.stock_reservations
    where job_id = p_job_id and item_id = p_item_id and status = 'Active'
    order by created_at
    for update
  loop
    exit when v_to_consume <= 0;
    if v_res.reserved_qty <= v_to_consume then
      v_to_consume := v_to_consume - v_res.reserved_qty;
      update public.stock_reservations set status = 'Consumed' where id = v_res.id;
    else
      update public.stock_reservations set reserved_qty = reserved_qty - v_to_consume where id = v_res.id;
      v_to_consume := 0;
    end if;
  end loop;

  update public.job_material_requirements
    set issued_qty = issued_qty + p_qty,
        reserved_qty = greatest(0, reserved_qty - p_qty)
    where job_id = p_job_id and item_id = p_item_id;

  v_value := round(p_qty * v_avg_cost, 2);
  if v_value > 0 then
    insert into public.job_cost_ledger (job_id, cost_type, amount, qty, item_id, memo, ref_table, ref_id, created_by)
    values (p_job_id, 'material', v_value, p_qty, p_item_id, 'Material issued', 'stock_ledger', p_job_id, auth.uid());

    perform public._fn_post_journal_entry_core(
      current_date, 'Material issued to ' || v_job.job_no, 'jobs', p_job_id,
      jsonb_build_array(
        jsonb_build_object('account_code','1320','debit',v_value,'credit',0,'memo','Work-in-Progress'),
        jsonb_build_object('account_code','1310','debit',0,'credit',v_value,'memo','Raw Material Inventory')
      )
    );
  end if;

  if v_job.status = 'MaterialAvailable' and not coalesce(v_had_issue, false) then
    update public.jobs set status = 'FabricationStarted' where id = p_job_id;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_mark_job_ready_for_dispatch(p_job_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.is_owner() or public.has_role('production')) then
    raise exception 'Only Owner or Production can do this.';
  end if;

  update public.jobs
    set status = 'ReadyForDispatch', progress_pct = 100
    where id = p_job_id and status in ('FabricationStarted','InProcess');

  if not found then
    raise exception 'Job cannot be marked Ready for Dispatch yet — fabrication must have started.';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_mark_quotation_sent(p_quotation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_query_id uuid;
  v_quotation_no text;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can do this.';
  end if;

  update public.quotations set status = 'Sent'
    where id = p_quotation_id and status = 'Draft'
    returning query_id, quotation_no into v_query_id, v_quotation_no;

  if v_query_id is null then
    raise exception 'Only a Draft Quotation can be marked as Sent.';
  end if;

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', v_query_id, 'system', 'Quotation ' || v_quotation_no || ' client ko bhej di gayi.', auth.uid());
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_record_dispute(p_dc_id uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.is_owner() or public.has_role('dispatch') or public.has_role('sales')) then
    raise exception 'You do not have permission to record a dispute.';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'A reason for the dispute is required.';
  end if;

  update public.delivery_challans
    set acceptance_status = 'Disputed', dispute_note = p_note
    where id = p_dc_id and status = 'Issued';
  if not found then
    raise exception 'DC not found or has already been cancelled.';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_record_pod(p_dc_id uuid, p_accepted_by_name text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.is_owner() or public.has_role('dispatch')) then
    raise exception 'Only Owner or Dispatch can record POD.';
  end if;
  if coalesce(trim(p_accepted_by_name), '') = '' then
    raise exception 'The name of the person accepting is required.';
  end if;

  update public.delivery_challans
    set acceptance_status = 'Accepted', accepted_by_name = p_accepted_by_name, accepted_at = now(), dispute_note = null
    where id = p_dc_id and status = 'Issued';
  if not found then
    raise exception 'DC not found or has already been cancelled.';
  end if;

  if coalesce(trim(p_note), '') <> '' then
    insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
    values ('delivery_challans', p_dc_id, 'status_change', p_note, auth.uid());
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_reject_stock_adjustment(p_adjustment_id uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_owner() then
    raise exception 'Only Owner can reject an adjustment.';
  end if;

  update public.stock_adjustments
    set status = 'Rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
    where id = p_adjustment_id and status = 'Pending';

  if not found then
    raise exception 'This adjustment is not Pending.';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_release_job_material(p_reservation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_res record;
begin
  if not (public.is_owner() or public.has_role('production') or public.has_role('store')) then
    raise exception 'You do not have permission to release this.';
  end if;

  select * into v_res from public.stock_reservations where id = p_reservation_id and status = 'Active' for update;
  if v_res.id is null then
    raise exception 'This reservation is not Active.';
  end if;

  update public.stock_reservations set status = 'Released' where id = p_reservation_id;

  update public.job_material_requirements
    set reserved_qty = greatest(0, reserved_qty - v_res.reserved_qty)
    where job_id = v_res.job_id and item_id = v_res.item_id;

  perform public._fn_recalc_job_material_status(v_res.job_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_reopen_task(p_task_id uuid)
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
    raise exception 'Only the assignee, the task creator, or the Owner can reopen it.';
  end if;
  if v_task.status = 'Open' then
    raise exception 'Task is already Open.';
  end if;

  update public.tasks
  set status = 'Open', completed_at = null, completed_by = null, cancel_reason = null, updated_by = auth.uid()
  where id = p_task_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_request_stock_adjustment(p_item_id uuid, p_warehouse_id uuid, p_qty_delta numeric, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if not (public.is_owner() or public.has_role('store')) then
    raise exception 'Only Owner or Store can request an adjustment.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required.';
  end if;
  if p_qty_delta = 0 then
    raise exception 'Qty delta cannot be zero.';
  end if;

  insert into public.stock_adjustments (item_id, warehouse_id, qty_delta, reason, requested_by)
  values (p_item_id, p_warehouse_id, p_qty_delta, p_reason, auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$
;
