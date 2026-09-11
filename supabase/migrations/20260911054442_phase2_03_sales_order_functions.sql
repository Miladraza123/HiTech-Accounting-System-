-- Recompute header totals from current lines
create or replace function public._fn_recalc_so_totals(p_sales_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtotal numeric;
  v_tax numeric;
begin
  select coalesce(sum(ordered_qty * rate), 0),
         coalesce(sum(ordered_qty * rate * tax_pct / 100), 0)
    into v_subtotal, v_tax
    from public.sales_order_lines where sales_order_id = p_sales_order_id;

  update public.sales_orders
    set subtotal = round(v_subtotal, 2),
        tax_total = round(v_tax, 2),
        grand_total = round(v_subtotal + v_tax, 2)
    where id = p_sales_order_id;
end;
$$;

-- Create a Sales Order from a Quotation.
-- p_confirm_duplicate = false (default): raises 'DUPLICATE_PO' if this
-- client already has an SO with the same PO number — the app catches this
-- exact message, shows a warning, and resubmits with confirm = true.
create or replace function public.fn_create_sales_order(
  p_quotation_id uuid,
  p_client_po_number text,
  p_po_date date,
  p_delivery_schedule date,
  p_payment_terms text,
  p_business_line text,
  p_lines jsonb,
  p_confirm_duplicate boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query_id uuid;
  v_party_id uuid;
  v_so_id uuid;
  v_so_no text;
  v_line jsonb;
  v_idx int := 0;
  v_dup_count int;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Sirf Owner ya Sales Sales Order bana sakte hain.';
  end if;
  if p_business_line not in ('material_supply','fabrication') then
    raise exception 'Business line batayen: material_supply ya fabrication.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Sales Order mein kam az kam ek line honi chahiye.';
  end if;

  select query_id, party_id into v_query_id, v_party_id from public.quotations where id = p_quotation_id;
  if v_party_id is null then
    raise exception 'Quotation nahi mili.';
  end if;

  select count(*) into v_dup_count
    from public.sales_orders
    where party_id = v_party_id and client_po_number = p_client_po_number;

  if v_dup_count > 0 and not p_confirm_duplicate then
    raise exception 'DUPLICATE_PO';
  end if;

  select public.fn_get_next_number('SO') into v_so_no;

  insert into public.sales_orders
    (so_no, quotation_id, query_id, party_id, client_po_number, po_date, delivery_schedule,
     payment_terms, business_line, responsible_user_id, created_by)
  values
    (v_so_no, p_quotation_id, v_query_id, v_party_id, p_client_po_number, p_po_date, p_delivery_schedule,
     p_payment_terms, p_business_line, auth.uid(), auth.uid())
  returning id into v_so_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.sales_order_lines (sales_order_id, item_id, description, ordered_qty, unit, rate, tax_pct, sort_order)
    values (
      v_so_id,
      nullif(v_line->>'item_id','')::uuid,
      v_line->>'description',
      (v_line->>'ordered_qty')::numeric,
      nullif(v_line->>'unit',''),
      (v_line->>'rate')::numeric,
      coalesce((v_line->>'tax_pct')::numeric, 0),
      v_idx
    );
    v_idx := v_idx + 1;
  end loop;

  perform public._fn_recalc_so_totals(v_so_id);

  update public.quotations set status = 'Accepted' where id = p_quotation_id and status in ('Draft','Sent');
  update public.queries set status = 'Won' where id = v_query_id;

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', v_query_id, 'system', 'Sales Order ' || v_so_no || ' bani (Client PO: ' || p_client_po_number || ').', auth.uid());

  return v_so_id;
end;
$$;

-- Amend a Sales Order: snapshot the current state first (never silently
-- overwritten), then apply the change. A line that already has deliveries
-- against it (delivered_qty > 0) cannot be removed.
create or replace function public.fn_amend_sales_order(
  p_sales_order_id uuid,
  p_reason text,
  p_client_po_number text,
  p_po_date date,
  p_delivery_schedule date,
  p_payment_terms text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot jsonb;
  v_next_rev int;
  v_revision_id uuid;
  v_line jsonb;
  v_kept_ids uuid[];
  v_idx int := 0;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Sirf Owner ya Sales amend kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Amendment ki wajah likhna zaroori hai.';
  end if;

  perform 1 from public.sales_orders where id = p_sales_order_id for update;
  if not found then
    raise exception 'Sales Order nahi mili.';
  end if;

  select jsonb_build_object(
    'client_po_number', so.client_po_number,
    'po_date', so.po_date,
    'delivery_schedule', so.delivery_schedule,
    'payment_terms', so.payment_terms,
    'lines', coalesce((select jsonb_agg(to_jsonb(l) order by l.sort_order) from public.sales_order_lines l where l.sales_order_id = p_sales_order_id), '[]'::jsonb)
  ) into v_snapshot
  from public.sales_orders so where so.id = p_sales_order_id;

  select coalesce(max(rev_no), 0) + 1 into v_next_rev
    from public.sales_order_revisions where sales_order_id = p_sales_order_id;

  insert into public.sales_order_revisions (sales_order_id, rev_no, reason, snapshot, created_by)
  values (p_sales_order_id, v_next_rev, p_reason, v_snapshot, auth.uid())
  returning id into v_revision_id;

  select array_agg((l->>'id')::uuid) filter (where l->>'id' is not null and l->>'id' <> '')
    into v_kept_ids
    from jsonb_array_elements(p_lines) l;

  if exists (
    select 1 from public.sales_order_lines
    where sales_order_id = p_sales_order_id and delivered_qty > 0
      and (v_kept_ids is null or not (id = any(v_kept_ids)))
  ) then
    raise exception 'Jis line par delivery ho chuki hai usay hataya nahi ja sakta — sirf qty/rate badal sakte hain.';
  end if;

  delete from public.sales_order_lines
  where sales_order_id = p_sales_order_id
    and (v_kept_ids is null or not (id = any(v_kept_ids)));

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if (v_line ? 'id') and v_line->>'id' <> '' then
      update public.sales_order_lines set
        item_id = nullif(v_line->>'item_id','')::uuid,
        description = v_line->>'description',
        ordered_qty = (v_line->>'ordered_qty')::numeric,
        unit = nullif(v_line->>'unit',''),
        rate = (v_line->>'rate')::numeric,
        tax_pct = coalesce((v_line->>'tax_pct')::numeric, 0),
        sort_order = v_idx
      where id = (v_line->>'id')::uuid;
    else
      insert into public.sales_order_lines (sales_order_id, item_id, description, ordered_qty, unit, rate, tax_pct, sort_order)
      values (
        p_sales_order_id,
        nullif(v_line->>'item_id','')::uuid,
        v_line->>'description',
        (v_line->>'ordered_qty')::numeric,
        nullif(v_line->>'unit',''),
        (v_line->>'rate')::numeric,
        coalesce((v_line->>'tax_pct')::numeric, 0),
        v_idx
      );
    end if;
    v_idx := v_idx + 1;
  end loop;

  update public.sales_orders set
    client_po_number = p_client_po_number,
    po_date = p_po_date,
    delivery_schedule = p_delivery_schedule,
    payment_terms = p_payment_terms
  where id = p_sales_order_id;

  perform public._fn_recalc_so_totals(p_sales_order_id);

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  select 'queries', so.query_id, 'system',
         'Sales Order ' || so.so_no || ' amend hui (Rev-' || v_next_rev || '). Wajah: ' || p_reason, auth.uid()
  from public.sales_orders so where so.id = p_sales_order_id;

  return v_revision_id;
end;
$$;

create or replace function public.fn_cancel_sales_order(p_sales_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query_id uuid;
  v_so_no text;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Sirf Owner ya Sales cancel kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancel karne ki wajah likhna zaroori hai.';
  end if;

  update public.sales_orders
    set status = 'Cancelled', cancel_reason = p_reason
    where id = p_sales_order_id and status not in ('Cancelled','Closed')
    returning query_id, so_no into v_query_id, v_so_no;

  if v_query_id is null then
    raise exception 'Yeh Sales Order cancel nahi ho sakti (shayad pehle se Cancelled/Closed hai).';
  end if;

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', v_query_id, 'status_change', 'Sales Order ' || v_so_no || ' cancel hui. Wajah: ' || p_reason, auth.uid());
end;
$$;

revoke execute on function public._fn_recalc_so_totals(uuid) from public, anon, authenticated;
revoke execute on function public.fn_create_sales_order(uuid, text, date, date, text, text, jsonb, boolean) from public, anon;
revoke execute on function public.fn_amend_sales_order(uuid, text, text, date, date, text, jsonb) from public, anon;
revoke execute on function public.fn_cancel_sales_order(uuid, text) from public, anon;

grant execute on function public.fn_create_sales_order(uuid, text, date, date, text, text, jsonb, boolean) to authenticated;
grant execute on function public.fn_amend_sales_order(uuid, text, text, date, date, text, jsonb) to authenticated;
grant execute on function public.fn_cancel_sales_order(uuid, text) to authenticated;
