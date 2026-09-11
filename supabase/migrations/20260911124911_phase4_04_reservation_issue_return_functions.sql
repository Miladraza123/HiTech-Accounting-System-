-- Manual reserve — staff can prioritise an urgent job over free stock
-- that would otherwise just sit unreserved.
create or replace function public.fn_reserve_job_material(
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
  v_free_qty numeric;
  v_id uuid;
begin
  if not (public.is_owner() or public.has_role('production') or public.has_role('store')) then
    raise exception 'Aapko reserve karne ki ijazat nahi.';
  end if;
  if p_qty <= 0 then
    raise exception 'Qty zero se zyada honi chahiye.';
  end if;
  if not exists (select 1 from public.job_material_requirements where job_id = p_job_id and item_id = p_item_id) then
    raise exception 'Yeh item is Job ki requirement mein nahi hai.';
  end if;

  select free_qty into v_free_qty from public.stock_availability where item_id = p_item_id and warehouse_id = p_warehouse_id;
  if coalesce(v_free_qty, 0) < p_qty then
    raise exception 'Free stock kam hai (available %, mangi %).', coalesce(v_free_qty, 0), p_qty;
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
$$;

create or replace function public.fn_release_job_material(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res record;
begin
  if not (public.is_owner() or public.has_role('production') or public.has_role('store')) then
    raise exception 'Aapko release karne ki ijazat nahi.';
  end if;

  select * into v_res from public.stock_reservations where id = p_reservation_id and status = 'Active' for update;
  if v_res.id is null then
    raise exception 'Yeh reservation Active nahi hai.';
  end if;

  update public.stock_reservations set status = 'Released' where id = p_reservation_id;

  update public.job_material_requirements
    set reserved_qty = greatest(0, reserved_qty - v_res.reserved_qty)
    where job_id = v_res.job_id and item_id = v_res.item_id;

  perform public._fn_recalc_job_material_status(v_res.job_id);
end;
$$;

-- Issue material to a Job — moves real stock, consumes the reservation,
-- posts Dr WIP / Cr Raw Material Inventory at the item's current
-- weighted-average cost, and (first issue only) advances the Job from
-- MaterialAvailable to FabricationStarted.
create or replace function public.fn_issue_job_material(
  p_job_id uuid,
  p_item_id uuid,
  p_qty numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_avg_cost numeric;
  v_value numeric;
  v_to_consume numeric;
  v_res record;
  v_had_issue boolean;
begin
  if not (public.is_owner() or public.has_role('production') or public.has_role('store')) then
    raise exception 'Aapko material issue karne ki ijazat nahi.';
  end if;
  if p_qty <= 0 then
    raise exception 'Qty zero se zyada honi chahiye.';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'Job nahi mili.';
  end if;
  if v_job.status in ('ReadyForDispatch','Delivered','Cancelled') then
    raise exception 'Is stage par material issue nahi ho sakta (%).', v_job.status;
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
$$;

create or replace function public.fn_return_job_material(
  p_job_id uuid,
  p_item_id uuid,
  p_qty numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_avg_cost numeric;
  v_value numeric;
  v_issued numeric;
begin
  if not (public.is_owner() or public.has_role('production') or public.has_role('store')) then
    raise exception 'Aapko material return karne ki ijazat nahi.';
  end if;
  if p_qty <= 0 then
    raise exception 'Qty zero se zyada honi chahiye.';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'Job nahi mili.';
  end if;

  select issued_qty - returned_qty into v_issued from public.job_material_requirements where job_id = p_job_id and item_id = p_item_id;
  if coalesce(v_issued, 0) < p_qty then
    raise exception 'Itna material issue hi nahi hua (available to return: %).', coalesce(v_issued, 0);
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
$$;

revoke execute on function public.fn_reserve_job_material(uuid, uuid, uuid, numeric) from public, anon;
revoke execute on function public.fn_release_job_material(uuid) from public, anon;
revoke execute on function public.fn_issue_job_material(uuid, uuid, numeric) from public, anon;
revoke execute on function public.fn_return_job_material(uuid, uuid, numeric) from public, anon;

grant execute on function public.fn_reserve_job_material(uuid, uuid, uuid, numeric) to authenticated;
grant execute on function public.fn_release_job_material(uuid) to authenticated;
grant execute on function public.fn_issue_job_material(uuid, uuid, numeric) to authenticated;
grant execute on function public.fn_return_job_material(uuid, uuid, numeric) to authenticated;
