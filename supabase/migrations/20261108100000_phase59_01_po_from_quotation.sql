-- Phase 59.01: one PO screen for a Quotation that mixes Material, Fabrication and Service lines.
--
-- Every quotation line can carry a type (material / fabrication / service). When the client's PO
-- arrives, fn_create_po_from_quotation creates, from the chosen lines in one step:
--   * a Material Supply Sales Order   (existing fn_create_sales_order)
--   * a Fabrication Sales Order       (existing fn_create_sales_order)
--   * a Service Job                   (existing fn_create_service_job)
-- all carrying the same client PO number and linked to the quotation. The existing functions and
-- tables keep working exactly as before; this only adds nullable columns and one new function.
-- Quotation lines saved before this migration have no type (null) and read as material.

-- ---------------------------------------------------------------------------
-- 1. Additive columns
-- ---------------------------------------------------------------------------
alter table public.quotation_lines
  add column if not exists line_type text check (line_type in ('material', 'fabrication', 'service'));

-- Which quotation line a Sales Order line came from (so "the remaining lines" can be offered later).
alter table public.sales_order_lines
  add column if not exists quotation_line_id uuid references public.quotation_lines(id) on delete set null;
create index if not exists sales_order_lines_quotation_line_idx on public.sales_order_lines (quotation_line_id)
  where quotation_line_id is not null;

-- A Service Job raised from a quotation: the quotation it came from and the quoted service lines.
alter table public.service_jobs
  add column if not exists quotation_id uuid references public.quotations(id) on delete set null;
alter table public.service_jobs
  add column if not exists quoted_lines jsonb not null default '[]'::jsonb;
create index if not exists service_jobs_quotation_idx on public.service_jobs (quotation_id)
  where quotation_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Saving quotation lines now keeps the type (same function every create / edit / revise uses)
-- ---------------------------------------------------------------------------
create or replace function public._fn_insert_quotation_lines(p_revision_id uuid, p_lines jsonb)
returns table(subtotal numeric, tax_total numeric, grand_total numeric)
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_line jsonb;
  v_idx int := 0;
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_type text;
begin
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Quotation must have at least one line.';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_type := nullif(btrim(coalesce(v_line->>'line_type', '')), '');
    if v_type is not null and v_type not in ('material', 'fabrication', 'service') then
      v_type := null;
    end if;
    insert into public.quotation_lines (revision_id, item_id, description, qty, unit, rate, tax_pct, sort_order, line_type)
    values (
      p_revision_id,
      nullif(v_line->>'item_id','')::uuid,
      v_line->>'description',
      (v_line->>'qty')::numeric,
      nullif(v_line->>'unit',''),
      (v_line->>'rate')::numeric,
      coalesce((v_line->>'tax_pct')::numeric, 0),
      v_idx,
      v_type
    );
    v_subtotal := v_subtotal + round((v_line->>'qty')::numeric * (v_line->>'rate')::numeric, 2);
    v_tax := v_tax + round((v_line->>'qty')::numeric * (v_line->>'rate')::numeric * coalesce((v_line->>'tax_pct')::numeric, 0) / 100, 2);
    v_idx := v_idx + 1;
  end loop;

  return query select v_subtotal, v_tax, v_subtotal + v_tax;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. The PO: Sales Orders (material / fabrication) and a Service Job in one step
-- ---------------------------------------------------------------------------
-- p_lines: [{quotation_line_id, line_type, item_id, description, qty, unit, rate, tax_pct}]
-- Returns {material_so_id, fabrication_so_id, service_job_id}; a key is null when that type has no line.
create or replace function public.fn_create_po_from_quotation(
  p_quotation_id uuid,
  p_client_po_number text,
  p_po_date date,
  p_delivery_schedule date,
  p_payment_terms text,
  p_lines jsonb,
  p_confirm_duplicate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  q record;
  v_line jsonb;
  v_type text;
  v_material jsonb := '[]'::jsonb;
  v_fab jsonb := '[]'::jsonb;
  v_service jsonb := '[]'::jsonb;
  v_so_mat uuid;
  v_so_fab uuid;
  v_job uuid;
  v_asset text;
  v_po text := btrim(coalesce(p_client_po_number, ''));
  v_notes text[] := '{}';
  v_idx int;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can enter a PO.';
  end if;
  if v_po = '' then
    raise exception 'Enter the client PO number.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Choose at least one line.';
  end if;

  select qt.id, qt.quotation_no, qt.party_id, qt.query_id into q from public.quotations qt where qt.id = p_quotation_id;
  if q.id is null then
    raise exception 'Quotation not found.';
  end if;

  -- Split the chosen lines by type and check them.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_type := coalesce(nullif(btrim(coalesce(v_line->>'line_type', '')), ''), 'material');
    if v_type not in ('material', 'fabrication', 'service') then
      raise exception 'Unknown line type: %', v_type;
    end if;
    if coalesce(btrim(v_line->>'description'), '') = '' then
      raise exception 'A line has no description.';
    end if;
    if coalesce((v_line->>'qty')::numeric, 0) <= 0 then
      raise exception 'Quantity must be more than zero (%).', v_line->>'description';
    end if;
    if v_type = 'material' then v_material := v_material || jsonb_build_array(v_line);
    elsif v_type = 'fabrication' then v_fab := v_fab || jsonb_build_array(v_line);
    else v_service := v_service || jsonb_build_array(v_line);
    end if;
  end loop;

  -- Same client + same PO number already entered (any Sales Order or Service Job): ask first.
  if not p_confirm_duplicate and (
       exists (select 1 from public.sales_orders where party_id = q.party_id and client_po_number = v_po)
    or exists (select 1 from public.service_jobs where party_id = q.party_id and client_po_no = v_po)
  ) then
    raise exception 'DUPLICATE_PO';
  end if;

  if jsonb_array_length(v_material) > 0 then
    v_so_mat := public.fn_create_sales_order(
      p_quotation_id, v_po, p_po_date, p_delivery_schedule, p_payment_terms, 'material_supply',
      (select jsonb_agg(jsonb_build_object(
          'item_id', nullif(l->>'item_id', ''), 'description', l->>'description', 'ordered_qty', (l->>'qty')::numeric,
          'unit', nullif(l->>'unit', ''), 'rate', (l->>'rate')::numeric, 'tax_pct', coalesce((l->>'tax_pct')::numeric, 0))
          order by o) from jsonb_array_elements(v_material) with ordinality as t(l, o)),
      true);
    v_idx := 0;
    for v_line in select * from jsonb_array_elements(v_material) loop
      update public.sales_order_lines
        set quotation_line_id = nullif(v_line->>'quotation_line_id', '')::uuid
        where sales_order_id = v_so_mat and sort_order = v_idx;
      v_idx := v_idx + 1;
    end loop;
    v_notes := array_append(v_notes, 'Material Supply Sales Order');
  end if;

  if jsonb_array_length(v_fab) > 0 then
    v_so_fab := public.fn_create_sales_order(
      p_quotation_id, v_po, p_po_date, p_delivery_schedule, p_payment_terms, 'fabrication',
      (select jsonb_agg(jsonb_build_object(
          'item_id', nullif(l->>'item_id', ''), 'description', l->>'description', 'ordered_qty', (l->>'qty')::numeric,
          'unit', nullif(l->>'unit', ''), 'rate', (l->>'rate')::numeric, 'tax_pct', coalesce((l->>'tax_pct')::numeric, 0))
          order by o) from jsonb_array_elements(v_fab) with ordinality as t(l, o)),
      true);
    v_idx := 0;
    for v_line in select * from jsonb_array_elements(v_fab) loop
      update public.sales_order_lines
        set quotation_line_id = nullif(v_line->>'quotation_line_id', '')::uuid
        where sales_order_id = v_so_fab and sort_order = v_idx;
      v_idx := v_idx + 1;
    end loop;
    v_notes := array_append(v_notes, 'Fabrication Sales Order');
  end if;

  if jsonb_array_length(v_service) > 0 then
    v_asset := left('Service as per Quotation ' || q.quotation_no || ': ' ||
      (select string_agg(btrim(split_part(l->>'description', E'\n', 1)), '; ' order by o)
         from jsonb_array_elements(v_service) with ordinality as t(l, o)), 500);
    v_job := public.fn_create_service_job(q.party_id, v_asset, null, null, null);
    update public.service_jobs
      set client_po_no = v_po,
          quotation_id = p_quotation_id,
          quoted_lines = (select jsonb_agg(jsonb_build_object(
              'quotation_line_id', l->>'quotation_line_id', 'item_id', nullif(l->>'item_id', ''), 'description', l->>'description',
              'qty', (l->>'qty')::numeric, 'unit', nullif(l->>'unit', ''), 'rate', (l->>'rate')::numeric,
              'tax_pct', coalesce((l->>'tax_pct')::numeric, 0)) order by o)
            from jsonb_array_elements(v_service) with ordinality as t(l, o))
      where id = v_job;
    v_notes := array_append(v_notes, 'Service Job');
  end if;

  -- What fn_create_sales_order already does for a Sales Order; a PO that is Service only needs it too.
  update public.quotations set status = 'Accepted' where id = p_quotation_id and status in ('Draft', 'Sent');
  update public.queries set status = 'Won' where id = q.query_id;
  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', q.query_id, 'system',
    'PO ' || v_po || ' entered from ' || q.quotation_no || ': ' || array_to_string(v_notes, ', ') || '.', auth.uid());

  return jsonb_build_object('material_so_id', v_so_mat, 'fabrication_so_id', v_so_fab, 'service_job_id', v_job);
end;
$fn$;

revoke all on function public.fn_create_po_from_quotation(uuid, text, date, date, text, jsonb, boolean) from public, anon;
grant execute on function public.fn_create_po_from_quotation(uuid, text, date, date, text, jsonb, boolean) to authenticated;
