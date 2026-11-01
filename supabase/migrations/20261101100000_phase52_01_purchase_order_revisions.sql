-- Phase 52: editing a saved Purchase Order, with a full revision history.
--
-- A Purchase Order used to be frozen once saved (only receive / cancel / close).
-- Now an Owner or Store user can correct it, under rules that keep stock and
-- accounts intact:
--   * Closed / Cancelled / fully Received POs are never editable.
--   * Lines that already have receipts keep their item, unit, rate and tax
--     (stock and the GRN journal were posted at that cost) and can't be removed
--     or reduced below the received qty; everything else can change.
--   * The supplier can change only while nothing has been received.
--   * Purchase type and the linked Sales Order stay fixed.
-- Every edit snapshots the version being replaced (who, when, why, what changed)
-- into purchase_order_revisions, which is append-only, and shows up in the
-- Activity Log.

alter table public.purchase_orders add column if not exists revision_no integer not null default 0;

create table if not exists public.purchase_order_revisions (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  rev_no integer not null,                -- the version this snapshot preserves (0 = as first saved)
  snapshot jsonb not null,                -- {header:{...}, lines:[...]} exactly as it was before the edit
  summary text not null,                  -- human-readable list of what changed
  reason text,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now(),
  unique (purchase_order_id, rev_no)
);
create index if not exists purchase_order_revisions_po_idx on public.purchase_order_revisions (purchase_order_id, rev_no);

alter table public.purchase_order_revisions enable row level security;
drop policy if exists p_select on public.purchase_order_revisions;
create policy p_select on public.purchase_order_revisions for select to authenticated using (true);
-- Append-only: rows are written only by fn_edit_purchase_order (SECURITY DEFINER); nobody edits history.
revoke all on public.purchase_order_revisions from anon, authenticated;
grant select on public.purchase_order_revisions to authenticated;

create or replace function public._fn_po_snapshot(p_purchase_order_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'header', jsonb_build_object(
      'po_no', po.po_no,
      'supplier_id', po.supplier_id,
      'supplier_name', pa.legal_name,
      'purchase_type', po.purchase_type,
      'linked_sales_order_id', po.linked_sales_order_id,
      'warehouse_id', po.warehouse_id,
      'warehouse_name', w.name,
      'expected_delivery', po.expected_delivery,
      'status', po.status,
      'subtotal', po.subtotal,
      'tax_total', po.tax_total,
      'grand_total', po.grand_total
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'item_id', l.item_id, 'description', l.description, 'ordered_qty', l.ordered_qty,
        'unit', l.unit, 'rate', l.rate, 'tax_pct', l.tax_pct, 'amount', l.amount, 'received_qty', l.received_qty
      ) order by l.sort_order, l.id)
      from public.purchase_order_lines l where l.purchase_order_id = po.id
    ), '[]'::jsonb)
  )
  from public.purchase_orders po
  join public.parties pa on pa.id = po.supplier_id
  left join public.warehouses w on w.id = po.warehouse_id
  where po.id = p_purchase_order_id;
$$;

create or replace function public.fn_edit_purchase_order(
  p_purchase_order_id uuid,
  p_expected_revision integer,
  p_supplier_id uuid,
  p_warehouse_id uuid,
  p_expected_delivery date,
  p_lines jsonb,
  p_reason text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders;
  v_old_snapshot jsonb;
  v_has_grn boolean;
  v_changes text[] := '{}';
  v_seen uuid[] := '{}';
  v_line jsonb;
  v_idx int := 0;
  v_id uuid;
  v_old public.purchase_order_lines;
  v_qty numeric;
  v_rate numeric;
  v_tax numeric;
  v_desc text;
  v_item uuid;
  v_unit text;
  v_new_supplier text;
  v_old_supplier text;
  v_all_received boolean;
  v_any_received boolean;
  v_new_status text;
  v_old_total numeric;
  v_new_total numeric;
  v_warehouse uuid;
begin
  if not (public.is_owner() or public.has_role('store')) then
    raise exception 'Only Owner or Store can edit a Purchase Order.';
  end if;

  select * into v_po from public.purchase_orders where id = p_purchase_order_id for update;
  if v_po.id is null then
    raise exception 'Purchase Order not found.';
  end if;
  if v_po.status in ('Cancelled', 'Closed', 'Received') then
    raise exception 'A % Purchase Order can no longer be edited.', v_po.status;
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_po.revision_no then
    raise exception 'This Purchase Order was changed by someone else while you were editing. Reload the page and try again.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A Purchase Order needs at least one line.';
  end if;

  v_has_grn := exists (select 1 from public.grns where purchase_order_id = v_po.id);
  v_old_snapshot := public._fn_po_snapshot(v_po.id);
  v_old_total := v_po.grand_total;

  -- ---- header -------------------------------------------------------------
  if p_supplier_id is null then
    raise exception 'Supplier is required.';
  end if;
  if p_supplier_id <> v_po.supplier_id then
    if v_has_grn then
      raise exception 'The supplier cannot be changed after goods have been received against this Purchase Order.';
    end if;
    select legal_name into v_new_supplier from public.parties
      where id = p_supplier_id and is_active and party_type in ('supplier', 'both');
    if v_new_supplier is null then
      raise exception 'Select an active supplier.';
    end if;
    select legal_name into v_old_supplier from public.parties where id = v_po.supplier_id;
    v_changes := v_changes || format('Supplier: %s -> %s', v_old_supplier, v_new_supplier);
  end if;

  v_warehouse := v_po.warehouse_id;
  if v_po.purchase_type = 'stock' then
    v_warehouse := coalesce(p_warehouse_id, v_po.warehouse_id);
    if v_warehouse is null then
      raise exception 'Warehouse is required for a stock purchase.';
    end if;
    if v_warehouse is distinct from v_po.warehouse_id then
      if v_has_grn then
        raise exception 'The warehouse cannot be changed after goods have been received against this Purchase Order.';
      end if;
      v_changes := v_changes || format('Warehouse: %s -> %s',
        coalesce((select name from public.warehouses where id = v_po.warehouse_id), '-'),
        coalesce((select name from public.warehouses where id = v_warehouse), '-'));
    end if;
  end if;

  if p_expected_delivery is distinct from v_po.expected_delivery then
    v_changes := v_changes || format('Expected delivery: %s -> %s',
      coalesce(v_po.expected_delivery::text, 'none'), coalesce(p_expected_delivery::text, 'none'));
  end if;

  -- ---- lines --------------------------------------------------------------
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_desc := btrim(coalesce(v_line->>'description', ''));
    v_qty := (v_line->>'ordered_qty')::numeric;
    v_rate := (v_line->>'rate')::numeric;
    v_tax := coalesce((v_line->>'tax_pct')::numeric, 0);
    v_item := nullif(v_line->>'item_id', '')::uuid;
    v_unit := nullif(v_line->>'unit', '');
    v_id := nullif(v_line->>'id', '')::uuid;

    if v_desc = '' then raise exception 'Every line needs a description.'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Line "%": quantity must be more than zero.', v_desc; end if;
    if v_rate is null or v_rate < 0 then raise exception 'Line "%": rate cannot be negative.', v_desc; end if;
    if v_tax < 0 or v_tax > 100 then raise exception 'Line "%": tax must be between 0 and 100.', v_desc; end if;

    if v_id is null then
      insert into public.purchase_order_lines (purchase_order_id, item_id, description, ordered_qty, unit, rate, tax_pct, sort_order)
      values (v_po.id, v_item, v_desc, v_qty, v_unit, v_rate, v_tax, v_idx);
      v_changes := v_changes || format('Added line "%s" (qty %s @ %s)', v_desc, trim_scale(v_qty), trim_scale(v_rate));
    else
      if v_id = any(v_seen) then raise exception 'A line appears twice in the request.'; end if;
      v_seen := v_seen || v_id;
      select * into v_old from public.purchase_order_lines where id = v_id and purchase_order_id = v_po.id for update;
      if v_old.id is null then raise exception 'A line of this Purchase Order was not found (it may have been removed).'; end if;

      if v_old.received_qty > 0 or exists (select 1 from public.grn_lines where po_line_id = v_old.id) then
        if v_qty < v_old.received_qty then
          raise exception 'Line "%": quantity cannot be below the % already received.', v_old.description, v_old.received_qty;
        end if;
        if v_old.item_id is not null and v_item is distinct from v_old.item_id then
          raise exception 'Line "%": the item cannot be changed after goods were received.', v_old.description;
        end if;
        if v_unit is distinct from v_old.unit or v_rate <> v_old.rate or v_tax <> v_old.tax_pct then
          raise exception 'Line "%": unit, rate and tax cannot be changed after goods were received.', v_old.description;
        end if;
      end if;

      if v_desc is distinct from v_old.description then
        v_changes := v_changes || format('Line "%s": description -> "%s"', v_old.description, v_desc);
      end if;
      if v_qty <> v_old.ordered_qty then
        v_changes := v_changes || format('Line "%s": qty %s -> %s', v_desc, trim_scale(v_old.ordered_qty), trim_scale(v_qty));
      end if;
      if v_rate <> v_old.rate then
        v_changes := v_changes || format('Line "%s": rate %s -> %s', v_desc, trim_scale(v_old.rate), trim_scale(v_rate));
      end if;
      if v_tax <> v_old.tax_pct then
        v_changes := v_changes || format('Line "%s": tax %s%% -> %s%%', v_desc, trim_scale(v_old.tax_pct), trim_scale(v_tax));
      end if;
      if v_unit is distinct from v_old.unit then
        v_changes := v_changes || format('Line "%s": unit %s -> %s', v_desc, coalesce(v_old.unit, '-'), coalesce(v_unit, '-'));
      end if;
      if v_item is distinct from v_old.item_id then
        v_changes := v_changes || format('Line "%s": item changed', v_desc);
      end if;

      update public.purchase_order_lines
        set item_id = v_item, description = v_desc, ordered_qty = v_qty, unit = v_unit,
            rate = v_rate, tax_pct = v_tax, sort_order = v_idx
        where id = v_id;
    end if;
    v_idx := v_idx + 1;
  end loop;

  -- Lines that were on the PO before this edit but are missing from the request are removed --
  -- unless goods were received on them.
  for v_old in
    select l.* from public.purchase_order_lines l
    where l.purchase_order_id = v_po.id
      and l.id <> all(v_seen)
      and l.id in (select (x->>'id')::uuid from jsonb_array_elements(v_old_snapshot->'lines') x)
  loop
    if v_old.received_qty > 0 or exists (select 1 from public.grn_lines where po_line_id = v_old.id) then
      raise exception 'Line "%" already has goods received and cannot be removed.', v_old.description;
    end if;
    delete from public.purchase_order_lines where id = v_old.id;
    v_changes := v_changes || format('Removed line "%s"', v_old.description);
  end loop;

  if cardinality(v_changes) = 0 then
    raise exception 'Nothing was changed.';
  end if;

  update public.purchase_orders
    set supplier_id = p_supplier_id, warehouse_id = v_warehouse, expected_delivery = p_expected_delivery
    where id = v_po.id;
  perform public._fn_recalc_po_totals(v_po.id);

  select bool_and(received_qty >= ordered_qty), bool_or(received_qty > 0)
    into v_all_received, v_any_received
    from public.purchase_order_lines where purchase_order_id = v_po.id;
  v_new_status := case when v_all_received then 'Received' when v_any_received then 'PartiallyReceived' else 'Confirmed' end;

  select grand_total into v_new_total from public.purchase_orders where id = v_po.id;
  if v_new_total <> v_old_total then
    v_changes := v_changes || format('Total: %s -> %s', trim_scale(v_old_total), trim_scale(v_new_total));
  end if;
  if v_new_status <> v_po.status then
    v_changes := v_changes || format('Status: %s -> %s', v_po.status, v_new_status);
  end if;

  update public.purchase_orders
    set status = v_new_status, revision_no = v_po.revision_no + 1
    where id = v_po.id;

  insert into public.purchase_order_revisions (purchase_order_id, rev_no, snapshot, summary, reason, changed_by)
  values (v_po.id, v_po.revision_no, v_old_snapshot, left(array_to_string(v_changes, '; '), 4000),
          nullif(btrim(coalesce(p_reason, '')), ''), auth.uid());

  return v_po.revision_no + 1;
end;
$$;

revoke all on function public.fn_edit_purchase_order(uuid, integer, uuid, uuid, date, jsonb, text) from public, anon;
grant execute on function public.fn_edit_purchase_order(uuid, integer, uuid, uuid, date, jsonb, text) to authenticated;
revoke all on function public._fn_po_snapshot(uuid) from public, anon;
grant execute on function public._fn_po_snapshot(uuid) to authenticated;

-- Activity Log: one entry per edit, showing who changed what. fn_activity_feed is
-- large, so it is patched in place (the replace calls are asserted to have matched).
do $patch$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.proname = 'fn_activity_feed' and p.pronamespace = 'public'::regnamespace;
  if v_def is null then
    raise exception 'fn_activity_feed not found';
  end if;
  if v_def like '%po_revision_events%' then
    return; -- already patched
  end if;

  v_new := replace(v_def,
    E'  events as (\n    select * from logins',
    $cte$  po_revision_events as (
    select r.changed_at as at,
           coalesce(p.full_name, 'Unknown user') as actor_name,
           'update' as event_type,
           'Edited Purchase Order (Rev ' || (r.rev_no + 1) || ')' as summary,
           po.po_no as doc_no,
           nullif(left(r.summary || coalesce(' [Reason: ' || r.reason || ']', ''), 400), '') as detail,
           null::text as ip_address,
           '/purchase-orders/' || r.purchase_order_id as link_href
    from public.purchase_order_revisions r
    join public.purchase_orders po on po.id = r.purchase_order_id
    left join public.profiles p on p.id = r.changed_by
  ),
  events as (
    select * from logins$cte$);
  if v_new = v_def then
    raise exception 'fn_activity_feed patch (CTE) did not apply';
  end if;
  v_def := v_new;
  v_new := replace(v_def, E'union all select * from business_events', E'union all select * from business_events\n    union all select * from po_revision_events');
  if v_new = v_def then
    raise exception 'fn_activity_feed patch (union) did not apply';
  end if;
  execute v_new;
end
$patch$;
