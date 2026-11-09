-- Phase 60.01: material issued against a Service Job (with its Raw Material DC) and the job's cost.
--
-- A Service Job could not record material at all. Now material can be issued to a job from a
-- warehouse (a "Site Material DC", SMD-...), and sent-back material recorded as a return
-- (SMR-...). Each issue or return:
--   * moves stock (same stock ledger every other module uses),
--   * writes the job's cost ledger (finance-only, like job_cost_ledger): issue = cost, return = minus,
--   * posts the journal: Dr 5020 Cost of Service Materials / Cr 1310 Raw Material Inventory
--     (a return is the reverse).
-- The cost expense is recognised when the material is issued (there is no work-in-progress step for
-- Service Jobs). Totals per job = sum of its cost ledger. A job that is Delivered or Cancelled is
-- frozen: no more issues, returns or cancellations.
--
-- Purely additive: no existing table or function is changed.

-- ---------------------------------------------------------------------------
-- 1. Account and numbering
-- ---------------------------------------------------------------------------
insert into public.chart_of_accounts (code, name, account_type, is_system) values
  ('5020', 'Cost of Service Materials', 'expense', true)
on conflict (code) do nothing;

insert into public.numbering_sequences (doc_type, label, prefix, padding, fy_reset, include_fy) values
  ('SMD', 'Site Material DC', 'SMD-', 4, true, true),
  ('SMR', 'Site Material Return', 'SMR-', 4, true, true)
on conflict (doc_type) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table public.service_material_docs (
  id uuid primary key default gen_random_uuid(),
  doc_no text not null unique,
  kind text not null check (kind in ('issue', 'return')),
  service_job_id uuid not null references public.service_jobs(id),
  party_id uuid not null references public.parties(id),
  warehouse_id uuid not null references public.warehouses(id),
  doc_date date not null default current_date,
  vehicle_no text,
  driver_name text,
  remarks text,
  status text not null default 'Issued' check (status in ('Issued', 'Cancelled')),
  cancel_reason text,
  journal_entry_id uuid references public.journal_entries(id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create index idx_smd_job on public.service_material_docs(service_job_id);

create table public.service_material_lines (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.service_material_docs(id) on delete cascade,
  item_id uuid not null references public.items(id),
  description text not null,
  qty numeric(18, 3) not null check (qty > 0),
  unit text,
  sort_order int not null default 0
);
create index idx_sml_doc on public.service_material_lines(doc_id);
create index idx_sml_item on public.service_material_lines(item_id);

-- Finance-only, like job_cost_ledger. Issue: +qty, +amount. Return / cancelled issue: minus.
create table public.service_job_cost_ledger (
  id uuid primary key default gen_random_uuid(),
  service_job_id uuid not null references public.service_jobs(id) on delete cascade,
  doc_id uuid references public.service_material_docs(id) on delete cascade,
  item_id uuid references public.items(id),
  qty numeric(18, 3),
  amount numeric(18, 2) not null,
  memo text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index idx_sjcl_job on public.service_job_cost_ledger(service_job_id);
create index idx_sjcl_doc on public.service_job_cost_ledger(doc_id);

create trigger trg_updated_at before update on public.service_material_docs for each row execute function public.fn_set_updated_at();
create trigger trg_audit after insert or update or delete on public.service_material_docs for each row execute function public.fn_audit_row();
create trigger trg_audit after insert or update or delete on public.service_material_lines for each row execute function public.fn_audit_row();
create trigger trg_audit after insert or update or delete on public.service_job_cost_ledger for each row execute function public.fn_audit_row();

alter table public.service_material_docs enable row level security;
alter table public.service_material_lines enable row level security;
alter table public.service_job_cost_ledger enable row level security;
-- Documents and quantities: operational, everyone reads (like Service Deliveries). Cost: finance only.
-- Every write goes through the functions below.
create policy p_select on public.service_material_docs for select to authenticated using (true);
create policy p_select on public.service_material_lines for select to authenticated using (true);
create policy p_select on public.service_job_cost_ledger for select to authenticated
  using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor'));
revoke all on public.service_material_docs, public.service_material_lines, public.service_job_cost_ledger from anon, authenticated;
grant select on public.service_material_docs, public.service_material_lines, public.service_job_cost_ledger to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Issue material to a Service Job / record material coming back
-- ---------------------------------------------------------------------------
-- p_kind: 'issue' or 'return'. p_lines: [{item_id, qty}] (qty in the item's base unit).
create or replace function public.fn_create_service_material_doc(
  p_service_job_id uuid,
  p_kind text,
  p_warehouse_id uuid,
  p_doc_date date,
  p_vehicle_no text,
  p_driver_name text,
  p_remarks text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_job record;
  v_doc_id uuid;
  v_doc_no text;
  v_line jsonb;
  v_item record;
  v_qty numeric;
  v_avg numeric;
  v_value numeric;
  v_total numeric := 0;
  v_net numeric;
  v_idx int := 0;
  v_je uuid;
  v_sign int;
begin
  if not (public.is_owner() or public.has_role('store') or public.has_role('dispatch')) then
    raise exception 'Only Owner, Store or Dispatch can issue or return material for a Service Job.';
  end if;
  if p_kind not in ('issue', 'return') or p_kind is null then
    raise exception 'Choose issue or return.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item.';
  end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse_id) then
    raise exception 'Choose a warehouse.';
  end if;

  select * into v_job from public.service_jobs where id = p_service_job_id for update;
  if v_job.id is null then
    raise exception 'Service Job not found.';
  end if;
  if v_job.status not in ('Received', 'Completed') then
    raise exception 'Material cannot be issued or returned on a Service Job that is % (only before delivery).', v_job.status;
  end if;

  v_sign := case when p_kind = 'issue' then 1 else -1 end;
  select public.fn_get_next_number(case when p_kind = 'issue' then 'SMD' else 'SMR' end) into v_doc_no;

  insert into public.service_material_docs
    (doc_no, kind, service_job_id, party_id, warehouse_id, doc_date, vehicle_no, driver_name, remarks, created_by)
  values
    (v_doc_no, p_kind, p_service_job_id, v_job.party_id, p_warehouse_id, coalesce(p_doc_date, current_date),
     nullif(btrim(p_vehicle_no), ''), nullif(btrim(p_driver_name), ''), nullif(btrim(p_remarks), ''), auth.uid())
  returning id into v_doc_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := coalesce((v_line ->> 'qty')::numeric, 0);
    if v_qty <= 0 then
      raise exception 'Quantity must be more than zero.';
    end if;
    select id, item_code, description, base_unit, is_stocked into v_item
      from public.items where id = nullif(v_line ->> 'item_id', '')::uuid;
    if v_item.id is null then
      raise exception 'Item not found.';
    end if;
    if not v_item.is_stocked then
      raise exception 'Item % is not a stocked item, so no stock can be issued for it.', v_item.item_code;
    end if;

    if p_kind = 'return' then
      -- cannot send back more than is out on this job (v_net counts what earlier lines of this document already return)
      select coalesce(sum(case when d.kind = 'issue' then l.qty else -l.qty end), 0) into v_net
        from public.service_material_lines l
        join public.service_material_docs d on d.id = l.doc_id
        where d.service_job_id = p_service_job_id and d.status = 'Issued' and l.item_id = v_item.id;
      if v_net - v_qty < 0 then
        raise exception 'That much % was not issued on this job (still out on the job: %).', v_item.item_code, v_net;
      end if;
    end if;

    select avg_cost into v_avg from public.stock_ledger
      where item_id = v_item.id and warehouse_id = p_warehouse_id order by seq desc limit 1;
    v_avg := coalesce(v_avg, 0);

    perform public._fn_post_stock_ledger(
      v_item.id, p_warehouse_id, case when p_kind = 'issue' then 'Issue' else 'Return' end,
      v_sign * -v_qty, v_avg, 'service_material_docs', v_doc_id,
      case when p_kind = 'issue' then 'Issued to ' else 'Returned from ' end || v_job.job_no || ' (' || v_doc_no || ')');

    v_value := round(v_qty * v_avg, 2);
    v_total := v_total + v_value;

    insert into public.service_material_lines (doc_id, item_id, description, qty, unit, sort_order)
    values (v_doc_id, v_item.id, v_item.description, v_qty, v_item.base_unit, v_idx);
    insert into public.service_job_cost_ledger (service_job_id, doc_id, item_id, qty, amount, memo, created_by)
    values (p_service_job_id, v_doc_id, v_item.id, v_sign * v_qty, v_sign * v_value,
            case when p_kind = 'issue' then 'Material issued ' else 'Material returned ' end || v_doc_no, auth.uid());
    v_idx := v_idx + 1;
  end loop;

  if v_total > 0 then
    v_je := public._fn_post_journal_entry_core(
      coalesce(p_doc_date, current_date),
      case when p_kind = 'issue' then 'Material issued to ' else 'Material returned from ' end || v_job.job_no || ' (' || v_doc_no || ')',
      'service_material_docs', v_doc_id,
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
  end if;

  return v_doc_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Cancel one of those documents (Owner only; only before the job is delivered)
-- ---------------------------------------------------------------------------
create or replace function public.fn_cancel_service_material_doc(p_doc_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  d record;
  v_job record;
  l record;
  v_cost record;
  v_total numeric := 0;
  v_net numeric;
  v_sign int;
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
  select * into v_job from public.service_jobs where id = d.service_job_id for update;
  if v_job.status not in ('Received', 'Completed') then
    raise exception 'The Service Job is % — its material can no longer be changed.', v_job.status;
  end if;

  v_sign := case when d.kind = 'issue' then 1 else -1 end;

  -- Cancelling an issue must not leave more material returned than issued, per item.
  if d.kind = 'issue' then
    for l in select item_id, sum(qty) q from public.service_material_lines where doc_id = d.id group by item_id loop
      select coalesce(sum(case when dd.kind = 'issue' then ll.qty else -ll.qty end), 0) into v_net
        from public.service_material_lines ll
        join public.service_material_docs dd on dd.id = ll.doc_id
        where dd.service_job_id = d.service_job_id and dd.status = 'Issued' and ll.item_id = l.item_id;
      if v_net - l.q < 0 then
        raise exception 'Cancel the material return first: more of an item was returned than would remain issued.';
      end if;
    end loop;
  end if;

  for l in select * from public.service_material_lines where doc_id = d.id order by sort_order loop
    select amount, qty into v_cost from public.service_job_cost_ledger
      where doc_id = d.id and item_id = l.item_id and qty = v_sign * l.qty and memo not like 'Cancelled%'
      order by created_at limit 1;
    -- put the stock back / take it out again at the cost it moved at
    perform public._fn_post_stock_ledger(
      l.item_id, d.warehouse_id, case when d.kind = 'issue' then 'Return' else 'Issue' end,
      v_sign * l.qty, case when l.qty = 0 then 0 else abs(coalesce(v_cost.amount, 0)) / l.qty end,
      'service_material_docs', d.id, 'Cancelled ' || d.doc_no);
    insert into public.service_job_cost_ledger (service_job_id, doc_id, item_id, qty, amount, memo, created_by)
    values (d.service_job_id, d.id, l.item_id, -v_sign * l.qty, -v_sign * abs(coalesce(v_cost.amount, 0)), 'Cancelled ' || d.doc_no, auth.uid());
    v_total := v_total + abs(coalesce(v_cost.amount, 0));
  end loop;

  if d.journal_entry_id is not null and v_total > 0 then
    perform public._fn_post_journal_entry_core(
      (now() at time zone 'Asia/Karachi')::date,
      'Cancelled ' || d.doc_no || ' (' || v_job.job_no || ')',
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
  end if;

  update public.service_material_docs set status = 'Cancelled', cancel_reason = btrim(p_reason) where id = d.id;
end;
$fn$;

revoke all on function public.fn_create_service_material_doc(uuid, text, uuid, date, text, text, text, jsonb) from public, anon;
grant execute on function public.fn_create_service_material_doc(uuid, text, uuid, date, text, text, text, jsonb) to authenticated;
revoke all on function public.fn_cancel_service_material_doc(uuid, text) from public, anon;
grant execute on function public.fn_cancel_service_material_doc(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Backup / restore: the new tables must be restorable
-- ---------------------------------------------------------------------------
do $patch$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public._fn_restore_pk_columns(text)'::regprocedure) into v_def;
  if v_def like '%service_material_docs%' and v_def like '%service_material_lines%' and v_def like '%service_job_cost_ledger%' then
    return;
  end if;
  v_new := v_def;
  if v_new not like '%service_material_docs%' then
    v_new := replace(v_new, 'else null', E'when ''service_material_docs'' then array[''id'']\n    else null');
  end if;
  if v_new not like '%service_material_lines%' then
    v_new := replace(v_new, 'else null', E'when ''service_material_lines'' then array[''id'']\n    else null');
  end if;
  if v_new not like '%service_job_cost_ledger%' then
    v_new := replace(v_new, 'else null', E'when ''service_job_cost_ledger'' then array[''id'']\n    else null');
  end if;
  if v_new = v_def then
    raise exception '_fn_restore_pk_columns patch did not apply';
  end if;
  execute v_new;
end
$patch$;
