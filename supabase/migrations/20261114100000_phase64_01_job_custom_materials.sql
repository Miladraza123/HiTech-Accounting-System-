-- Phase 64.01: custom (typed) material on a Job.
--
-- A Job's material requirements are stock items. Material that is not in the Item Master (a typed name,
-- quantity and unit) can now be listed on the Job too. These lines are a plain list: no stock is reserved or
-- issued, they never change the Job's status, and nothing is posted to the accounts. (When such material is
-- actually sent to site it goes through the Raw Material DC as a custom line.)
--
-- Purely additive: one new table and one new function. fn_create_job is NOT changed; the new function calls it
-- whenever the Job has stock requirements or a template, and only a Job with custom material and nothing else
-- is created here (the same checks and the same insert, with no requirements).

create table public.job_custom_materials (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  name text not null check (btrim(name) <> '' and char_length(name) <= 200),
  required_qty numeric(18, 3) not null check (required_qty > 0),
  unit text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) default auth.uid()
);
create index idx_jcm_job on public.job_custom_materials(job_id);

create trigger trg_audit after insert or update or delete on public.job_custom_materials for each row execute function public.fn_audit_row();

alter table public.job_custom_materials enable row level security;
create policy p_select on public.job_custom_materials for select to authenticated using (true);
revoke all on public.job_custom_materials from anon, authenticated;
grant select on public.job_custom_materials to authenticated;

-- p_custom_lines: [{name, required_qty, unit}]
create or replace function public.fn_create_job_with_custom(
  p_sales_order_line_id uuid,
  p_warehouse_id uuid,
  p_product_template_id uuid,
  p_description text,
  p_job_qty numeric,
  p_responsible_user_id uuid,
  p_start_date date,
  p_required_delivery_date date,
  p_material_lines jsonb,
  p_custom_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_job_id uuid;
  v_job_no text;
  v_so_id uuid;
  v_business_line text;
  v_ordered_qty numeric;
  v_jobbed_qty numeric;
  v_line jsonb;
  v_name text;
  v_qty numeric;
  v_idx int := 0;
  v_has_custom boolean := p_custom_lines is not null and jsonb_typeof(p_custom_lines) = 'array' and jsonb_array_length(p_custom_lines) > 0;
  v_has_stock boolean := p_product_template_id is not null
    or (p_material_lines is not null and jsonb_typeof(p_material_lines) = 'array' and jsonb_array_length(p_material_lines) > 0);
begin
  if not (public.is_owner() or public.has_role('production')) then
    raise exception 'Only Owner or Production can create a Job.';
  end if;

  if not v_has_custom then
    -- nothing custom: exactly the existing function
    return public.fn_create_job(p_sales_order_line_id, p_warehouse_id, p_product_template_id, p_description, p_job_qty,
                                p_responsible_user_id, p_start_date, p_required_delivery_date, coalesce(p_material_lines, '[]'::jsonb));
  end if;

  for v_line in select * from jsonb_array_elements(p_custom_lines) loop
    v_name := btrim(coalesce(v_line ->> 'name', ''));
    if v_name = '' then
      raise exception 'Write the name of every custom material.';
    end if;
    if char_length(v_name) > 200 then
      raise exception 'A custom material name is too long.';
    end if;
    begin
      v_qty := (v_line ->> 'required_qty')::numeric;
    exception when others then
      raise exception 'Enter a valid quantity for "%".', v_name;
    end;
    if v_qty is null or v_qty <= 0 then
      raise exception 'The quantity of "%" must be more than zero.', v_name;
    end if;
  end loop;

  if v_has_stock then
    -- stock requirements and/or a template: the existing function creates the Job and its requirements
    v_job_id := public.fn_create_job(p_sales_order_line_id, p_warehouse_id, p_product_template_id, p_description, p_job_qty,
                                     p_responsible_user_id, p_start_date, p_required_delivery_date, coalesce(p_material_lines, '[]'::jsonb));
  else
    -- custom material only: the same checks and insert as fn_create_job, with no requirements to reserve
    if p_job_qty is null or p_job_qty <= 0 then
      raise exception 'Job qty must be greater than zero.';
    end if;
    select sol.sales_order_id, so.business_line into v_so_id, v_business_line
      from public.sales_order_lines sol
      join public.sales_orders so on so.id = sol.sales_order_id
      where sol.id = p_sales_order_line_id;
    if v_so_id is null then
      raise exception 'Sales Order line not found.';
    end if;
    select ordered_qty into v_ordered_qty from public.sales_order_lines where id = p_sales_order_line_id for update;
    select coalesce(sum(job_qty), 0) into v_jobbed_qty from public.jobs
      where sales_order_line_id = p_sales_order_line_id and status <> 'Cancelled';
    if v_jobbed_qty + p_job_qty > v_ordered_qty then
      raise exception 'Job qty exceeds the Sales Order line: ordered %, already in Jobs %, this Job %.', v_ordered_qty, v_jobbed_qty, p_job_qty;
    end if;
    if v_business_line <> 'fabrication' then
      raise exception 'A Job can only be created for a Sales Order in the Fabrication business line.';
    end if;
    select public.fn_get_next_number('JOB') into v_job_no;
    insert into public.jobs
      (job_no, sales_order_id, sales_order_line_id, product_template_id, warehouse_id,
       description, job_qty, responsible_user_id, start_date, required_delivery_date, created_by)
    values
      (v_job_no, v_so_id, p_sales_order_line_id, null, p_warehouse_id,
       p_description, p_job_qty, p_responsible_user_id, p_start_date, p_required_delivery_date, auth.uid())
    returning id into v_job_id;
    perform public._fn_recalc_job_material_status(v_job_id);
  end if;

  for v_line in select * from jsonb_array_elements(p_custom_lines) loop
    insert into public.job_custom_materials (job_id, name, required_qty, unit, sort_order)
    values (v_job_id, btrim(v_line ->> 'name'), (v_line ->> 'required_qty')::numeric, nullif(btrim(coalesce(v_line ->> 'unit', '')), ''), v_idx);
    v_idx := v_idx + 1;
  end loop;

  return v_job_id;
end;
$fn$;

revoke all on function public.fn_create_job_with_custom(uuid, uuid, uuid, text, numeric, uuid, date, date, jsonb, jsonb) from public, anon;
grant execute on function public.fn_create_job_with_custom(uuid, uuid, uuid, text, numeric, uuid, date, date, jsonb, jsonb) to authenticated;

-- Backup / restore: the new table must be restorable
do $patch$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public._fn_restore_pk_columns(text)'::regprocedure) into v_def;
  if v_def like '%job_custom_materials%' then
    return;
  end if;
  v_new := replace(v_def, 'else null', E'when ''job_custom_materials'' then array[''id'']\n    else null');
  if v_new = v_def then
    raise exception '_fn_restore_pk_columns patch did not apply';
  end if;
  execute v_new;
end
$patch$;
