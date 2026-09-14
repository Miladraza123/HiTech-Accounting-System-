-- Phase 29.07 — Master Offline-First Roadmap, Phase 7: offline-first
-- CREATE for the Fabrication/Job module.
--
-- Sub-audit finding (read the actual schema/functions before writing any
-- code, per this project's own rule): there is no "coil"/"multi-coil
-- cutting" schema anywhere in this codebase (confirmed — grep across every
-- migration for "coil" returns nothing). The real fabrication module is
-- the generic BOM/Job engine in phase4_0*_fabrication*.sql: Product
-- Templates (a reusable BOM "recipe"), Jobs (created against a
-- `fabrication`-business-line Sales Order line, optionally from a
-- template), Job Material Requirements, Stock Reservations
-- (auto + manual), Job Material Issue/Return (moves real stock, posts
-- Dr WIP / Cr Raw Material Inventory), and one-way Job status transitions
-- (progress update / ready-for-dispatch / cancel). This migration offline
-- -enables every genuine "create" in that module; the plan's own phase
-- description is corrected to match below.
--
-- Same idempotent-create pattern as every earlier phase (client-generated
-- UUID, safe to call twice) for the two document creates:
--   - fn_create_product_template_idempotent
--   - fn_create_job_idempotent (also auto-reserves free stock, exactly
--     like the original fn_create_job — same one-transaction guarantee:
--     a race lost on the id guard returns early before any reservation
--     is touched)
--
-- fn_reserve_job_material_idempotent similarly creates one new
-- stock_reservations row, just with a client-supplied id instead of the
-- table's own default.
--
-- Material Issue and Return are NOT "create a new document" the same way
-- — they mutate an existing job_material_requirements counter row rather
-- than inserting a freshly-addressable one, so the client-generated-id
-- guard has nothing to key off in the tables the original functions
-- touch. The new job_material_events table below (RLS: select only for
-- authenticated, no insert policy — every row can only be written by a
-- SECURITY DEFINER RPC that has already passed the p_id idempotency
-- check, the same defense-in-depth already used for job_cost_ledger)
-- exists purely to be that key: one row per client-generated event id,
-- checked FIRST exactly like every other idempotent RPC's target-table
-- check, with the exact same insert-then-recheck race guard before any
-- stock/reservation/costing side effect runs.
--
-- Coil-balance-style concurrency risk this phase actually has (confirmed
-- by reading the bodies, not assumed): fn_issue_job_material both posts to
-- the advisory-lock-protected _fn_post_stock_ledger (so a negative
-- resulting balance is rejected exactly like every other stock movement)
-- AND consumes stock_reservations `for update` in the same transaction —
-- so a retried/racing call is only ever fully applied once (idempotency
-- guard) or fully rolled back together (single transaction), never
-- partially.
--
-- Release Reservation / Update Progress / Mark Ready For Dispatch /
-- Cancel Job are deliberately NOT offline-enabled here — they are
-- one-way status transitions on an already-existing, already-synced Job
-- (exactly the same category as Stock Adjustment *approval* in Phase 6:
-- a distinct, always-online review/workflow action, not a "create").
--
-- Reachability: Product Template creation references only master data
-- (Items/Units), so — like Stock Transfer/Stock Adjustment in Phase 6 —
-- it has no parent-not-yet-synced constraint. Job creation and the
-- Job Material Panel actions all live on pages that live-fetch their
-- parent (the Sales Order line, or the Job itself) and 404 if not found
-- — the same already-documented constraint as every phase since Phase 2.

create table public.job_material_events (
  id uuid primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  item_id uuid not null references public.items(id),
  event_type text not null check (event_type in ('issue', 'return')),
  qty numeric(18,3) not null check (qty > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index idx_jme_job on public.job_material_events(job_id);
create index idx_jme_item on public.job_material_events(item_id);
create index idx_jme_created_by on public.job_material_events(created_by);

alter table public.job_material_events enable row level security;

-- Select only — inserts happen exclusively through the SECURITY DEFINER
-- RPCs below (same pattern as job_cost_ledger, which also has no insert
-- policy of its own).
create policy p_select on public.job_material_events for select to authenticated using (true);


create or replace function public.fn_create_product_template_idempotent(
  p_id uuid,
  p_template_code text,
  p_name text,
  p_description text,
  p_output_item_id uuid,
  p_output_unit text,
  p_lines jsonb -- [{item_id, qty_per_unit, unit}]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_line jsonb;
  v_idx int := 0;
begin
  if not (public.is_owner() or public.has_role('production')) then
    raise exception 'Only Owner or Production can create a Product Template.';
  end if;

  select id into v_existing from public.product_templates where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'A Template needs at least one raw material line.';
  end if;

  insert into public.product_templates (id, template_code, name, description, output_item_id, output_unit, created_by)
  values (p_id, p_template_code, p_name, p_description, p_output_item_id, p_output_unit, auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.product_templates where id = p_id;
    return v_existing;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.product_template_lines (template_id, item_id, qty_per_unit, unit, sort_order)
    values (p_id, (v_line->>'item_id')::uuid, (v_line->>'qty_per_unit')::numeric, nullif(v_line->>'unit', ''), v_idx);
    v_idx := v_idx + 1;
  end loop;

  return p_id;
end;
$$;

revoke execute on function public.fn_create_product_template_idempotent(uuid, text, text, text, uuid, text, jsonb) from public, anon;
grant execute on function public.fn_create_product_template_idempotent(uuid, text, text, text, uuid, text, jsonb) to authenticated;


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


create or replace function public.fn_reserve_job_material_idempotent(
  p_id uuid,
  p_job_id uuid,
  p_item_id uuid,
  p_warehouse_id uuid,
  p_qty numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_free_qty numeric;
begin
  if not (public.is_owner() or public.has_role('production') or public.has_role('store')) then
    raise exception 'Only Owner, Production or Store can reserve material.';
  end if;

  select id into v_existing from public.stock_reservations where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_qty <= 0 then
    raise exception 'Qty must be greater than zero.';
  end if;
  if not exists (select 1 from public.job_material_requirements where job_id = p_job_id and item_id = p_item_id) then
    raise exception 'This item is not in the Job material requirement.';
  end if;

  select free_qty into v_free_qty from public.stock_availability where item_id = p_item_id and warehouse_id = p_warehouse_id;
  if coalesce(v_free_qty, 0) < p_qty then
    raise exception 'Not enough free stock (available %, requested %).', coalesce(v_free_qty, 0), p_qty;
  end if;

  insert into public.stock_reservations (id, job_id, item_id, warehouse_id, reserved_qty, reservation_mode, created_by)
  values (p_id, p_job_id, p_item_id, p_warehouse_id, p_qty, 'manual', auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.stock_reservations where id = p_id;
    return v_existing;
  end if;

  update public.job_material_requirements
    set reserved_qty = reserved_qty + p_qty
    where job_id = p_job_id and item_id = p_item_id;

  perform public._fn_recalc_job_material_status(p_job_id);
  return p_id;
end;
$$;

revoke execute on function public.fn_reserve_job_material_idempotent(uuid, uuid, uuid, uuid, numeric) from public, anon;
grant execute on function public.fn_reserve_job_material_idempotent(uuid, uuid, uuid, uuid, numeric) to authenticated;


create or replace function public.fn_issue_job_material_idempotent(
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
  v_to_consume numeric;
  v_res record;
  v_had_issue boolean;
begin
  if not (public.is_owner() or public.has_role('production') or public.has_role('store')) then
    raise exception 'Only Owner, Production or Store can issue material.';
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
  if v_job.status in ('ReadyForDispatch', 'Delivered', 'Cancelled') then
    raise exception 'Material cannot be issued at this stage (%).', v_job.status;
  end if;
  if not exists (select 1 from public.job_material_requirements where job_id = p_job_id and item_id = p_item_id) then
    raise exception 'This item is not in the Job material requirement.';
  end if;

  insert into public.job_material_events (id, job_id, item_id, event_type, qty, created_by)
  values (p_id, p_job_id, p_item_id, 'issue', p_qty, auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.job_material_events where id = p_id;
    return v_existing;
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
    values (p_job_id, 'material', v_value, p_qty, p_item_id, 'Material issued', 'job_material_events', p_id, auth.uid());

    perform public._fn_post_journal_entry_core(
      current_date, 'Material issued to ' || v_job.job_no, 'job_material_events', p_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '1320', 'debit', v_value, 'credit', 0, 'memo', 'Work-in-Progress'),
        jsonb_build_object('account_code', '1310', 'debit', 0, 'credit', v_value, 'memo', 'Raw Material Inventory')
      )
    );
  end if;

  if v_job.status = 'MaterialAvailable' and not coalesce(v_had_issue, false) then
    update public.jobs set status = 'FabricationStarted' where id = p_job_id;
  end if;

  return p_id;
end;
$$;

revoke execute on function public.fn_issue_job_material_idempotent(uuid, uuid, uuid, numeric) from public, anon;
grant execute on function public.fn_issue_job_material_idempotent(uuid, uuid, uuid, numeric) to authenticated;


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
    order by created_at desc, id desc limit 1;
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
