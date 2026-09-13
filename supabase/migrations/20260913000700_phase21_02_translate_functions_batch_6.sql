-- Translates Roman-Urdu user-facing exception/notice messages in the following
-- PL/pgSQL functions to professional English. No logic, control flow, SQL
-- statements, signatures, or comments were changed — only the text inside
-- raise exception/notice/warning string literals was translated.
--   fn_reserve_job_material, fn_return_job_material, fn_set_period_lock,
--   fn_set_query_status, fn_set_role_permission, fn_update_draft_quotation,
--   fn_update_job_progress, fn_update_task

CREATE OR REPLACE FUNCTION public.fn_reserve_job_material(p_job_id uuid, p_item_id uuid, p_warehouse_id uuid, p_qty numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_free_qty numeric;
  v_id uuid;
begin
  if not (public.is_owner() or public.has_role('production') or public.has_role('store')) then
    raise exception 'You do not have permission to reserve materials.';
  end if;
  if p_qty <= 0 then
    raise exception 'Qty must be greater than zero.';
  end if;
  if not exists (select 1 from public.job_material_requirements where job_id = p_job_id and item_id = p_item_id) then
    raise exception 'This item is not in this Job''s requirements.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_item_id::text || ':' || p_warehouse_id::text, 0));

  select free_qty into v_free_qty from public.stock_availability where item_id = p_item_id and warehouse_id = p_warehouse_id;
  if coalesce(v_free_qty, 0) < p_qty then
    raise exception 'Insufficient free stock (available %, requested %).', coalesce(v_free_qty, 0), p_qty;
  end if;

  insert into public.stock_reservations (job_id, item_id, warehouse_id, reserved_qty, reservation_mode, created_by)
  values (p_job_id, p_item_id, p_warehouse_id, p_qty, 'manual', auth.uid())
  returning id into v_id;

  update public.job_material_requirements
    set reserved_qty = reserved_qty + p_qty
    where job_id = p_job_id and item_id = p_item_id;

  perform public._fn_recalc_job_material_status(p_job_id);
  return v_id;
end;
$function$
;

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

  select issued_qty - returned_qty into v_issued from public.job_material_requirements where job_id = p_job_id and item_id = p_item_id;
  if coalesce(v_issued, 0) < p_qty then
    raise exception 'That much material was not issued (available to return: %).', coalesce(v_issued, 0);
  end if;

  select avg_cost into v_avg_cost from public.stock_ledger
    where item_id = p_item_id and warehouse_id = v_job.warehouse_id
    order by created_at desc, id desc limit 1;
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

CREATE OR REPLACE FUNCTION public.fn_set_period_lock(p_lock_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_owner() then
    raise exception 'Only the Owner can set/change the Period Lock.';
  end if;
  update public.company set period_lock_date = p_lock_date;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_set_query_status(p_query_id uuid, p_status text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can change the status.';
  end if;
  if p_status not in ('Open','Quoted','Won','Lost','OnHold') then
    raise exception 'Invalid status: %', p_status;
  end if;

  update public.queries set status = p_status where id = p_query_id;

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', p_query_id, 'status_change', coalesce(p_note, 'Status: ' || p_status), auth.uid());
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_set_role_permission(p_permission_key text, p_role_codes text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_owner() then
    raise exception 'Only the Owner can change the Permission Matrix.';
  end if;
  update public.role_permissions
    set role_codes = coalesce(p_role_codes, '{}'), updated_by = auth.uid()
    where permission_key = p_permission_key;
  if not found then
    raise exception 'Unknown permission key: %', p_permission_key;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_update_draft_quotation(p_quotation_id uuid, p_terms text, p_validity_date date, p_delivery_terms text, p_payment_terms text, p_lines jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
  v_revision_id uuid;
  v_totals record;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can edit the Quotation.';
  end if;

  select status into v_status from public.quotations where id = p_quotation_id for update;
  if v_status is null then
    raise exception 'Quotation not found.';
  end if;
  if v_status <> 'Draft' then
    raise exception 'This Quotation has already been sent — create a new Revision to make changes.';
  end if;

  select id into v_revision_id from public.quotation_revisions
    where quotation_id = p_quotation_id and is_current limit 1;

  update public.quotation_revisions
    set terms = p_terms, validity_date = p_validity_date,
        delivery_terms = p_delivery_terms, payment_terms = p_payment_terms
    where id = v_revision_id;

  delete from public.quotation_lines where revision_id = v_revision_id;

  select * into v_totals from public._fn_insert_quotation_lines(v_revision_id, p_lines);

  update public.quotation_revisions
    set subtotal = v_totals.subtotal, tax_total = v_totals.tax_total, grand_total = v_totals.grand_total
    where id = v_revision_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_update_job_progress(p_job_id uuid, p_progress_pct integer, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
begin
  if not (public.is_owner() or public.has_role('production')) then
    raise exception 'Only Owner or Production can update progress.';
  end if;
  if p_progress_pct < 0 or p_progress_pct > 100 then
    raise exception 'Progress must be between 0 and 100.';
  end if;

  select status into v_status from public.jobs where id = p_job_id;
  if v_status is null then
    raise exception 'Job not found.';
  end if;
  if v_status in ('ReadyForDispatch','Delivered','Cancelled') then
    raise exception 'Progress cannot be updated at this stage (%).', v_status;
  end if;

  update public.jobs
    set progress_pct = p_progress_pct,
        status = case when status = 'FabricationStarted' and p_progress_pct > 0 then 'InProcess' else status end
    where id = p_job_id;

  if coalesce(trim(p_note), '') <> '' then
    insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
    values ('jobs', p_job_id, 'note', p_note, auth.uid());
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_update_task(p_task_id uuid, p_title text, p_assigned_to uuid, p_description text DEFAULT NULL::text, p_due_date date DEFAULT NULL::date, p_priority text DEFAULT 'Medium'::text)
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
    raise exception 'Only the task creator or the Owner can edit it.';
  end if;
  if v_task.status <> 'Open' then
    raise exception 'Only Open tasks can be edited — reopen it first.';
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

  update public.tasks
  set title = trim(p_title), description = p_description, due_date = p_due_date,
      priority = p_priority, assigned_to = p_assigned_to, updated_by = auth.uid()
  where id = p_task_id;
end;
$function$
;
