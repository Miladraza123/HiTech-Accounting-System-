create or replace function public.fn_create_product_template(
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
  v_id uuid;
  v_line jsonb;
  v_idx int := 0;
begin
  if not (public.is_owner() or public.has_role('production')) then
    raise exception 'Sirf Owner ya Production template bana sakte hain.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Template mein kam az kam ek raw material line honi chahiye.';
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
$$;

-- Recompute a Job's material status from its requirement rows. Only moves
-- between MaterialPending <-> MaterialAvailable — never touches a job that
-- has already moved on to FabricationStarted+ (issuing material is what
-- advances it from there).
create or replace function public._fn_recalc_job_material_status(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_all_covered boolean;
begin
  select status into v_status from public.jobs where id = p_job_id;
  if v_status not in ('MaterialPending','MaterialAvailable') then
    return;
  end if;

  select bool_and(reserved_qty >= required_qty) into v_all_covered
    from public.job_material_requirements where job_id = p_job_id;

  update public.jobs
    set status = case when coalesce(v_all_covered, true) then 'MaterialAvailable' else 'MaterialPending' end
    where id = p_job_id;
end;
$$;

revoke execute on function public._fn_recalc_job_material_status(uuid) from public, anon, authenticated;

-- Create a Job against a (fabrication) Sales Order line. If a BOM template
-- is given, material requirements are computed as qty_per_unit * job_qty;
-- otherwise p_material_lines supplies them directly. Free stock is
-- auto-reserved up to what's available — any shortfall stays visible as
-- required_qty > reserved_qty ("Purchase Required").
create or replace function public.fn_create_job(
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
  v_so_id uuid;
  v_business_line text;
  v_job_id uuid;
  v_job_no text;
  v_line jsonb;
  v_free_qty numeric;
  v_to_reserve numeric;
begin
  if not (public.is_owner() or public.has_role('production')) then
    raise exception 'Sirf Owner ya Production Job bana sakte hain.';
  end if;
  if p_job_qty <= 0 then
    raise exception 'Job qty zero se zyada honi chahiye.';
  end if;

  select sol.sales_order_id, so.business_line into v_so_id, v_business_line
    from public.sales_order_lines sol
    join public.sales_orders so on so.id = sol.sales_order_id
    where sol.id = p_sales_order_line_id;

  if v_so_id is null then
    raise exception 'Sales Order line nahi mili.';
  end if;
  if v_business_line <> 'fabrication' then
    raise exception 'Job sirf Fabrication business line ki Sales Order ke liye ban sakti hai.';
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
      raise exception 'Material requirement batayen (ya koi template select karen).';
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
$$;

revoke execute on function public.fn_create_product_template(text, text, text, uuid, text, jsonb) from public, anon;
revoke execute on function public.fn_create_job(uuid, uuid, uuid, text, numeric, uuid, date, date, jsonb) from public, anon;

grant execute on function public.fn_create_product_template(text, text, text, uuid, text, jsonb) to authenticated;
grant execute on function public.fn_create_job(uuid, uuid, uuid, text, numeric, uuid, date, date, jsonb) to authenticated;
