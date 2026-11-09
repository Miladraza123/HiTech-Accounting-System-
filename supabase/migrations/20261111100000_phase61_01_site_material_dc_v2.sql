-- Phase 61.01: the Site Material DC grows up.
--
--  * Header: Reference and a DC description (printed as "Ref/PO Number" and "Project").
--  * Each line may carry its own description (printed in the Remarks column).
--  * Each line is either a STOCK item (stock moves, cost from the average cost) or a CUSTOM item
--    (free-text name, no stock movement, cost typed in). A custom line's cost shows in the job's cost
--    but posts NOTHING to the accounts: such material is bought separately and its expense is already
--    in the books (supplier bill / purchase), so booking it again would count it twice. For the same
--    reason it is kept out of job_cost_ledger (which feeds the Sales Order Cost & Profit panel and the
--    WIP-to-COGS release) and lives in service_job_cost_ledger only.
--  * The same document now works for a Fabrication Job. Its stock lines go through the existing Job
--    material functions when the item is in the job's material requirements (so requirements, reservations
--    and the job cost ledger stay exactly as before); for an item outside the requirements the stock, the
--    job_cost_ledger row and the Work-in-Progress journal are posted directly, the same way.
--
-- The tables from phase 60 are still empty, so changing their shape touches no data.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
alter table public.service_material_docs alter column service_job_id drop not null;
alter table public.service_material_docs alter column warehouse_id drop not null;
alter table public.service_material_docs add column if not exists job_id uuid references public.jobs(id);
alter table public.service_material_docs add column if not exists reference text;
alter table public.service_material_docs add column if not exists dc_description text;
alter table public.service_material_docs drop constraint if exists smd_one_job_chk;
alter table public.service_material_docs add constraint smd_one_job_chk check ((service_job_id is not null) <> (job_id is not null));
create index if not exists idx_smd_fjob on public.service_material_docs(job_id) where job_id is not null;

alter table public.service_material_lines alter column item_id drop not null;
alter table public.service_material_lines add column if not exists is_stock boolean not null default true;
alter table public.service_material_lines add column if not exists line_description text;
alter table public.service_material_lines drop constraint if exists sml_stock_item_chk;
alter table public.service_material_lines add constraint sml_stock_item_chk check (is_stock = (item_id is not null));

alter table public.service_job_cost_ledger alter column service_job_id drop not null;
alter table public.service_job_cost_ledger add column if not exists job_id uuid references public.jobs(id) on delete cascade;
alter table public.service_job_cost_ledger add column if not exists line_id uuid references public.service_material_lines(id) on delete cascade;
alter table public.service_job_cost_ledger add column if not exists label text;
alter table public.service_job_cost_ledger drop constraint if exists sjcl_one_job_chk;
alter table public.service_job_cost_ledger add constraint sjcl_one_job_chk check ((service_job_id is not null) <> (job_id is not null));
create index if not exists idx_sjcl_fjob on public.service_job_cost_ledger(job_id) where job_id is not null;
create index if not exists idx_sjcl_line on public.service_job_cost_ledger(line_id) where line_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Helper: quantity of an item still out on a job (issued minus returned, cancelled documents ignored)
-- ---------------------------------------------------------------------------
create or replace function public._fn_site_material_net(p_service_job_id uuid, p_job_id uuid, p_item_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(sum(case when d.kind = 'issue' then l.qty else -l.qty end), 0)
  from public.service_material_lines l
  join public.service_material_docs d on d.id = l.doc_id
  where d.status = 'Issued' and l.is_stock and l.item_id = p_item_id
    and ((p_service_job_id is not null and d.service_job_id = p_service_job_id)
      or (p_job_id is not null and d.job_id = p_job_id));
$fn$;
revoke all on function public._fn_site_material_net(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Create a Site Material DC (issue) or a material return, for a Service Job OR a Fabrication Job
-- ---------------------------------------------------------------------------
-- p_lines: [{is_stock (default true), item_id (stock) | custom_name + unit + unit_cost (custom), qty, description}]
-- (The phase 60 function fn_create_service_material_doc stays until the new screens are deployed; it still
-- works with the new table shape and is removed by a later cleanup.)

create or replace function public.fn_create_site_material_doc(
  p_service_job_id uuid,
  p_job_id uuid,
  p_kind text,
  p_doc_date date,
  p_warehouse_id uuid,
  p_vehicle_no text,
  p_driver_name text,
  p_reference text,
  p_dc_description text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_fab boolean := p_job_id is not null;
  v_svc record;
  v_job record;
  v_party uuid;
  v_wh uuid;
  v_job_no text;
  v_doc_id uuid;
  v_doc_no text;
  v_line jsonb;
  v_line_id uuid;
  v_item record;
  v_qty numeric;
  v_avg numeric;
  v_value numeric;
  v_is_stock boolean;
  v_name text;
  v_unit_cost numeric;
  v_unit text;
  v_desc text;
  v_total numeric := 0;
  v_wip numeric := 0;
  v_sign int;
  v_idx int := 0;
  v_je uuid;
  v_net numeric;
  v_req boolean;
  v_narr text;
begin
  if (p_service_job_id is null) = (p_job_id is null) then
    raise exception 'Choose either a Service Job or a Fabrication Job.';
  end if;
  if v_fab then
    if not (public.is_owner() or public.has_role('production') or public.has_role('store')) then
      raise exception 'Only Owner, Production or Store can issue or return material for a Job.';
    end if;
  elsif not (public.is_owner() or public.has_role('store') or public.has_role('dispatch')) then
    raise exception 'Only Owner, Store or Dispatch can issue or return material for a Service Job.';
  end if;
  if p_kind not in ('issue', 'return') or p_kind is null then
    raise exception 'Choose issue or return.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item.';
  end if;
  if p_kind = 'return' and exists (
    select 1 from jsonb_array_elements(p_lines) l where not coalesce((l ->> 'is_stock')::boolean, true)
  ) then
    raise exception 'Only stocked items can be recorded as returned.';
  end if;

  if v_fab then
    select * into v_job from public.jobs where id = p_job_id for update;
    if v_job.id is null then
      raise exception 'Job not found.';
    end if;
    if v_job.status in ('ReadyForDispatch', 'Delivered', 'Cancelled') then
      raise exception 'Material cannot be issued or returned on a Job that is % (only before dispatch).', v_job.status;
    end if;
    select party_id into v_party from public.sales_orders where id = v_job.sales_order_id;
    v_wh := v_job.warehouse_id;
    v_job_no := v_job.job_no;
  else
    select * into v_svc from public.service_jobs where id = p_service_job_id for update;
    if v_svc.id is null then
      raise exception 'Service Job not found.';
    end if;
    if v_svc.status not in ('Received', 'Completed') then
      raise exception 'Material cannot be issued or returned on a Service Job that is % (only before delivery).', v_svc.status;
    end if;
    v_party := v_svc.party_id;
    v_wh := p_warehouse_id;
    v_job_no := v_svc.job_no;
  end if;

  if exists (select 1 from jsonb_array_elements(p_lines) l where coalesce((l ->> 'is_stock')::boolean, true))
     and (v_wh is null or not exists (select 1 from public.warehouses where id = v_wh)) then
    raise exception 'Choose a warehouse.';
  end if;

  v_sign := case when p_kind = 'issue' then 1 else -1 end;
  select public.fn_get_next_number(case when p_kind = 'issue' then 'SMD' else 'SMR' end) into v_doc_no;

  insert into public.service_material_docs
    (doc_no, kind, service_job_id, job_id, party_id, warehouse_id, doc_date, vehicle_no, driver_name, reference, dc_description, created_by)
  values
    (v_doc_no, p_kind, p_service_job_id, p_job_id, v_party, v_wh, coalesce(p_doc_date, current_date),
     nullif(btrim(p_vehicle_no), ''), nullif(btrim(p_driver_name), ''), nullif(btrim(p_reference), ''),
     nullif(btrim(p_dc_description), ''), auth.uid())
  returning id into v_doc_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := coalesce((v_line ->> 'qty')::numeric, 0);
    if v_qty <= 0 then
      raise exception 'Quantity must be more than zero.';
    end if;
    v_is_stock := coalesce((v_line ->> 'is_stock')::boolean, true);
    v_desc := nullif(btrim(coalesce(v_line ->> 'description', '')), '');

    if v_is_stock then
      select id, item_code, description, base_unit, is_stocked into v_item
        from public.items where id = nullif(v_line ->> 'item_id', '')::uuid;
      if v_item.id is null then
        raise exception 'Choose a stock item on every stock line.';
      end if;
      if not v_item.is_stocked then
        raise exception 'Item % is not a stocked item, so no stock can be issued for it. Use a custom item instead.', v_item.item_code;
      end if;

      if p_kind = 'return' then
        v_net := public._fn_site_material_net(p_service_job_id, p_job_id, v_item.id);
        if v_net - v_qty < 0 then
          raise exception 'That much % was not issued on this job (still out on the job: %).', v_item.item_code, v_net;
        end if;
      end if;

      select avg_cost into v_avg from public.stock_ledger
        where item_id = v_item.id and warehouse_id = v_wh order by seq desc limit 1;
      v_avg := coalesce(v_avg, 0);
      v_value := round(v_qty * v_avg, 2);

      insert into public.service_material_lines (doc_id, item_id, description, qty, unit, sort_order, is_stock, line_description)
      values (v_doc_id, v_item.id, v_item.description, v_qty, v_item.base_unit, v_idx, true, v_desc)
      returning id into v_line_id;

      if not v_fab then
        perform public._fn_post_stock_ledger(
          v_item.id, v_wh, case when p_kind = 'issue' then 'Issue' else 'Return' end,
          v_sign * -v_qty, v_avg, 'service_material_docs', v_doc_id,
          case when p_kind = 'issue' then 'Issued to ' else 'Returned from ' end || v_job_no || ' (' || v_doc_no || ')');
        insert into public.service_job_cost_ledger (service_job_id, doc_id, line_id, item_id, qty, amount, memo, created_by)
        values (p_service_job_id, v_doc_id, v_line_id, v_item.id, v_sign * v_qty, v_sign * v_value,
                case when p_kind = 'issue' then 'Material issued ' else 'Material returned ' end || v_doc_no, auth.uid());
        v_total := v_total + v_value;
      else
        select exists (select 1 from public.job_material_requirements where job_id = p_job_id and item_id = v_item.id) into v_req;
        if v_req then
          -- the existing Job functions do the stock, requirement, reservation, cost ledger and journal
          if p_kind = 'issue' then
            perform public.fn_issue_job_material(p_job_id, v_item.id, v_qty);
          else
            perform public.fn_return_job_material(p_job_id, v_item.id, v_qty);
          end if;
        else
          perform public._fn_post_stock_ledger(
            v_item.id, v_wh, case when p_kind = 'issue' then 'Issue' else 'Return' end,
            v_sign * -v_qty, v_avg, 'service_material_docs', v_doc_id,
            case when p_kind = 'issue' then 'Issued to ' else 'Returned from ' end || v_job_no || ' (' || v_doc_no || ')');
          insert into public.job_cost_ledger (job_id, cost_type, amount, qty, item_id, memo, ref_table, ref_id, created_by)
          values (p_job_id, 'material', v_sign * v_value, v_sign * v_qty, v_item.id,
                  case when p_kind = 'issue' then 'Material issued ' else 'Material returned ' end || v_doc_no,
                  'service_material_docs', v_doc_id, auth.uid());
          v_wip := v_wip + v_value;
        end if;
      end if;
    else
      -- custom item: no stock, no journal; its cost is only shown on the job
      v_name := nullif(btrim(coalesce(v_line ->> 'custom_name', '')), '');
      if v_name is null then
        raise exception 'Write the name of the custom item.';
      end if;
      if char_length(v_name) > 200 then
        raise exception 'The custom item name is too long.';
      end if;
      v_unit_cost := coalesce((v_line ->> 'unit_cost')::numeric, 0);
      if v_unit_cost < 0 then
        raise exception 'The cost of "%" cannot be negative.', v_name;
      end if;
      v_unit := nullif(btrim(coalesce(v_line ->> 'unit', '')), '');
      insert into public.service_material_lines (doc_id, item_id, description, qty, unit, sort_order, is_stock, line_description)
      values (v_doc_id, null, v_name, v_qty, v_unit, v_idx, false, v_desc)
      returning id into v_line_id;
      insert into public.service_job_cost_ledger (service_job_id, job_id, doc_id, line_id, item_id, label, qty, amount, memo, created_by)
      values (p_service_job_id, p_job_id, v_doc_id, v_line_id, null, v_name, v_qty, round(v_qty * v_unit_cost, 2),
              'Custom material ' || v_doc_no, auth.uid());
    end if;
    v_idx := v_idx + 1;
  end loop;

  v_narr := case when p_kind = 'issue' then 'Material issued to ' else 'Material returned from ' end || v_job_no || ' (' || v_doc_no || ')';
  if not v_fab and v_total > 0 then
    v_je := public._fn_post_journal_entry_core(
      coalesce(p_doc_date, current_date), v_narr, 'service_material_docs', v_doc_id,
      case when p_kind = 'issue' then
        jsonb_build_array(
          jsonb_build_object('account_code', '5020', 'debit', v_total, 'credit', 0, 'memo', 'Cost of Service Materials'),
          jsonb_build_object('account_code', '1310', 'debit', 0, 'credit', v_total, 'memo', 'Raw Material Inventory'))
      else
        jsonb_build_array(
          jsonb_build_object('account_code', '1310', 'debit', v_total, 'credit', 0, 'memo', 'Raw Material Inventory'),
          jsonb_build_object('account_code', '5020', 'debit', 0, 'credit', v_total, 'memo', 'Cost of Service Materials'))
      end);
    update public.service_material_docs set journal_entry_id = v_je where id = v_doc_id;
  elsif v_fab and v_wip > 0 then
    v_je := public._fn_post_journal_entry_core(
      coalesce(p_doc_date, current_date), v_narr, 'service_material_docs', v_doc_id,
      case when p_kind = 'issue' then
        jsonb_build_array(
          jsonb_build_object('account_code', '1320', 'debit', v_wip, 'credit', 0, 'memo', 'Work-in-Progress'),
          jsonb_build_object('account_code', '1310', 'debit', 0, 'credit', v_wip, 'memo', 'Raw Material Inventory'))
      else
        jsonb_build_array(
          jsonb_build_object('account_code', '1310', 'debit', v_wip, 'credit', 0, 'memo', 'Raw Material Inventory'),
          jsonb_build_object('account_code', '1320', 'debit', 0, 'credit', v_wip, 'memo', 'Work-in-Progress'))
      end);
    update public.service_material_docs set journal_entry_id = v_je where id = v_doc_id;
  end if;

  return v_doc_id;
end;
$fn$;

revoke all on function public.fn_create_site_material_doc(uuid, uuid, text, date, uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.fn_create_site_material_doc(uuid, uuid, text, date, uuid, text, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Cancel such a document (Owner only; only while the job can still change)
-- ---------------------------------------------------------------------------
create or replace function public.fn_cancel_service_material_doc(p_doc_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  d record;
  v_fab boolean;
  v_job record;
  v_svc record;
  v_job_no text;
  l record;
  v_c record;
  v_total numeric := 0;
  v_wip numeric := 0;
  v_net numeric;
  v_sign int;
  v_req boolean;
begin
  if not public.is_owner() then
    raise exception 'Only the Owner can cancel a material document.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required.';
  end if;

  select * into d from public.service_material_docs where id = p_doc_id for update;
  if d.id is null then
    raise exception 'Document not found.';
  end if;
  if d.status = 'Cancelled' then
    raise exception 'This document is already cancelled.';
  end if;
  v_fab := d.job_id is not null;
  if v_fab then
    select * into v_job from public.jobs where id = d.job_id for update;
    if v_job.status in ('ReadyForDispatch', 'Delivered', 'Cancelled') then
      raise exception 'The Job is % — its material can no longer be changed.', v_job.status;
    end if;
    v_job_no := v_job.job_no;
  else
    select * into v_svc from public.service_jobs where id = d.service_job_id for update;
    if v_svc.status not in ('Received', 'Completed') then
      raise exception 'The Service Job is % — its material can no longer be changed.', v_svc.status;
    end if;
    v_job_no := v_svc.job_no;
  end if;

  v_sign := case when d.kind = 'issue' then 1 else -1 end;

  if d.kind = 'issue' then
    for l in select item_id, sum(qty) q from public.service_material_lines where doc_id = d.id and is_stock group by item_id loop
      v_net := public._fn_site_material_net(d.service_job_id, d.job_id, l.item_id);
      if v_net - l.q < 0 then
        raise exception 'Cancel the material return first: more of an item was returned than would remain issued.';
      end if;
    end loop;
  end if;

  for l in select * from public.service_material_lines where doc_id = d.id order by sort_order loop
    if not l.is_stock then
      select * into v_c from public.service_job_cost_ledger where line_id = l.id and memo not like 'Cancelled%' order by created_at limit 1;
      insert into public.service_job_cost_ledger (service_job_id, job_id, doc_id, line_id, item_id, label, qty, amount, memo, created_by)
      values (d.service_job_id, d.job_id, d.id, l.id, null, v_c.label, -v_c.qty, -v_c.amount, 'Cancelled ' || d.doc_no, auth.uid());
    elsif not v_fab then
      select * into v_c from public.service_job_cost_ledger where line_id = l.id and memo not like 'Cancelled%' order by created_at limit 1;
      if v_c.id is null then
        -- a document made by the phase 60 function: its cost rows carry no line id
        select * into v_c from public.service_job_cost_ledger
          where doc_id = d.id and item_id = l.item_id and qty = v_sign * l.qty and memo not like 'Cancelled%'
          order by created_at limit 1;
      end if;
      perform public._fn_post_stock_ledger(
        l.item_id, d.warehouse_id, case when d.kind = 'issue' then 'Return' else 'Issue' end,
        v_sign * l.qty, case when l.qty = 0 then 0 else abs(coalesce(v_c.amount, 0)) / l.qty end,
        'service_material_docs', d.id, 'Cancelled ' || d.doc_no);
      insert into public.service_job_cost_ledger (service_job_id, doc_id, line_id, item_id, qty, amount, memo, created_by)
      values (d.service_job_id, d.id, l.id, l.item_id, -v_c.qty, -v_c.amount, 'Cancelled ' || d.doc_no, auth.uid());
      v_total := v_total + abs(coalesce(v_c.amount, 0));
    else
      select exists (select 1 from public.job_material_requirements where job_id = d.job_id and item_id = l.item_id) into v_req;
      if v_req then
        if d.kind = 'issue' then
          perform public.fn_return_job_material(d.job_id, l.item_id, l.qty);
        else
          perform public.fn_issue_job_material(d.job_id, l.item_id, l.qty);
        end if;
      else
        select * into v_c from public.job_cost_ledger
          where ref_table = 'service_material_docs' and ref_id = d.id and item_id = l.item_id
            and qty = v_sign * l.qty and memo not like 'Cancelled%'
          order by created_at limit 1;
        perform public._fn_post_stock_ledger(
          l.item_id, d.warehouse_id, case when d.kind = 'issue' then 'Return' else 'Issue' end,
          v_sign * l.qty, case when l.qty = 0 then 0 else abs(coalesce(v_c.amount, 0)) / l.qty end,
          'service_material_docs', d.id, 'Cancelled ' || d.doc_no);
        insert into public.job_cost_ledger (job_id, cost_type, amount, qty, item_id, memo, ref_table, ref_id, created_by)
        values (d.job_id, 'material', -v_c.amount, -v_c.qty, l.item_id, 'Cancelled ' || d.doc_no, 'service_material_docs', d.id, auth.uid());
        v_wip := v_wip + abs(coalesce(v_c.amount, 0));
      end if;
    end if;
  end loop;

  if d.journal_entry_id is not null and not v_fab and v_total > 0 then
    perform public._fn_post_journal_entry_core(
      (now() at time zone 'Asia/Karachi')::date,
      'Cancelled ' || d.doc_no || ' (' || v_job_no || ')',
      'service_material_docs', d.id,
      case when d.kind = 'issue' then
        jsonb_build_array(
          jsonb_build_object('account_code', '1310', 'debit', v_total, 'credit', 0, 'memo', 'Raw Material Inventory (reversed)'),
          jsonb_build_object('account_code', '5020', 'debit', 0, 'credit', v_total, 'memo', 'Cost of Service Materials (reversed)'))
      else
        jsonb_build_array(
          jsonb_build_object('account_code', '5020', 'debit', v_total, 'credit', 0, 'memo', 'Cost of Service Materials (reversed)'),
          jsonb_build_object('account_code', '1310', 'debit', 0, 'credit', v_total, 'memo', 'Raw Material Inventory (reversed)'))
      end);
  elsif d.journal_entry_id is not null and v_fab and v_wip > 0 then
    perform public._fn_post_journal_entry_core(
      (now() at time zone 'Asia/Karachi')::date,
      'Cancelled ' || d.doc_no || ' (' || v_job_no || ')',
      'service_material_docs', d.id,
      case when d.kind = 'issue' then
        jsonb_build_array(
          jsonb_build_object('account_code', '1310', 'debit', v_wip, 'credit', 0, 'memo', 'Raw Material Inventory (reversed)'),
          jsonb_build_object('account_code', '1320', 'debit', 0, 'credit', v_wip, 'memo', 'Work-in-Progress (reversed)'))
      else
        jsonb_build_array(
          jsonb_build_object('account_code', '1320', 'debit', v_wip, 'credit', 0, 'memo', 'Work-in-Progress (reversed)'),
          jsonb_build_object('account_code', '1310', 'debit', 0, 'credit', v_wip, 'memo', 'Raw Material Inventory (reversed)'))
      end);
  end if;

  update public.service_material_docs set status = 'Cancelled', cancel_reason = btrim(p_reason) where id = d.id;
end;
$fn$;
