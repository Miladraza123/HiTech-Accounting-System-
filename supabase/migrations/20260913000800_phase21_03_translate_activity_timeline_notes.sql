-- Phase 21.03: translate the remaining Roman-Urdu text found by the
-- final sweep after phase21_02 — human-readable activity_timeline
-- "note" values built via string concatenation (not a raise
-- exception/notice/warning argument, so the batch agents intentionally
-- left these alone per their scope). No logic changes — only the
-- literal text inside these concatenated strings is translated.

CREATE OR REPLACE FUNCTION public.fn_create_quotation(p_query_id uuid, p_terms text, p_validity_date date, p_delivery_terms text, p_payment_terms text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_party_id uuid;
  v_quotation_id uuid;
  v_revision_id uuid;
  v_quotation_no text;
  v_totals record;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can create a Quotation.';
  end if;

  select party_id into v_party_id from public.queries where id = p_query_id;
  if v_party_id is null then
    raise exception 'Query not found.';
  end if;

  select public.fn_get_next_number('QTN') into v_quotation_no;

  insert into public.quotations (quotation_no, query_id, party_id, responsible_user_id, status)
  values (v_quotation_no, p_query_id, v_party_id, auth.uid(), 'Draft')
  returning id into v_quotation_id;

  insert into public.quotation_revisions (quotation_id, rev_no, terms, validity_date, delivery_terms, payment_terms, is_current, created_by)
  values (v_quotation_id, 0, p_terms, p_validity_date, p_delivery_terms, p_payment_terms, true, auth.uid())
  returning id into v_revision_id;

  select * into v_totals from public._fn_insert_quotation_lines(v_revision_id, p_lines);

  update public.quotation_revisions
    set subtotal = v_totals.subtotal, tax_total = v_totals.tax_total, grand_total = v_totals.grand_total
    where id = v_revision_id;

  update public.queries set status = 'Quoted' where id = p_query_id and status = 'Open';

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', p_query_id, 'system', 'Quotation ' || v_quotation_no || ' (Rev-0) was created.', auth.uid());

  return v_quotation_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_mark_quotation_sent(p_quotation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_query_id uuid;
  v_quotation_no text;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can do this.';
  end if;

  update public.quotations set status = 'Sent'
    where id = p_quotation_id and status = 'Draft'
    returning query_id, quotation_no into v_query_id, v_quotation_no;

  if v_query_id is null then
    raise exception 'Only a Draft Quotation can be marked as Sent.';
  end if;

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', v_query_id, 'system', 'Quotation ' || v_quotation_no || ' was sent to the client.', auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_create_quotation_revision(p_quotation_id uuid, p_reason text, p_terms text, p_validity_date date, p_delivery_terms text, p_payment_terms text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_query_id uuid;
  v_quotation_no text;
  v_next_rev int;
  v_revision_id uuid;
  v_totals record;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can create a Revision.';
  end if;

  select query_id, quotation_no into v_query_id, v_quotation_no
    from public.quotations where id = p_quotation_id for update;
  if v_query_id is null then
    raise exception 'Quotation not found.';
  end if;

  select coalesce(max(rev_no), -1) + 1 into v_next_rev
    from public.quotation_revisions where quotation_id = p_quotation_id;

  update public.quotation_revisions set is_current = false
    where quotation_id = p_quotation_id and is_current;

  insert into public.quotation_revisions
    (quotation_id, rev_no, terms, validity_date, delivery_terms, payment_terms, is_current, reason, created_by)
  values
    (p_quotation_id, v_next_rev, p_terms, p_validity_date, p_delivery_terms, p_payment_terms, true, p_reason, auth.uid())
  returning id into v_revision_id;

  select * into v_totals from public._fn_insert_quotation_lines(v_revision_id, p_lines);

  update public.quotation_revisions
    set subtotal = v_totals.subtotal, tax_total = v_totals.tax_total, grand_total = v_totals.grand_total
    where id = v_revision_id;

  update public.quotations set status = 'Draft' where id = p_quotation_id;

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', v_query_id, 'system',
    'Quotation ' || v_quotation_no || ' Rev-' || v_next_rev || ' was created. Reason: ' || coalesce(p_reason, '-'),
    auth.uid());

  return v_revision_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_amend_sales_order(p_sales_order_id uuid, p_reason text, p_client_po_number text, p_po_date date, p_delivery_schedule date, p_payment_terms text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_snapshot jsonb;
  v_next_rev int;
  v_revision_id uuid;
  v_line jsonb;
  v_kept_ids uuid[];
  v_idx int := 0;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can amend.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason for the amendment is required.';
  end if;

  perform 1 from public.sales_orders where id = p_sales_order_id for update;
  if not found then
    raise exception 'Sales Order not found.';
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
    raise exception 'A line that has already been delivered cannot be removed — only qty/rate can be changed.';
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
         'Sales Order ' || so.so_no || ' was amended (Rev-' || v_next_rev || '). Reason: ' || p_reason, auth.uid()
  from public.sales_orders so where so.id = p_sales_order_id;

  return v_revision_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_cancel_sales_order(p_sales_order_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_query_id uuid;
  v_so_no text;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can cancel.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason for cancelling is required.';
  end if;

  update public.sales_orders
    set status = 'Cancelled', cancel_reason = p_reason
    where id = p_sales_order_id and status not in ('Cancelled','Closed')
    returning query_id, so_no into v_query_id, v_so_no;

  if v_query_id is null then
    raise exception 'This Sales Order cannot be cancelled (it may already be Cancelled/Closed).';
  end if;

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', v_query_id, 'status_change', 'Sales Order ' || v_so_no || ' was cancelled. Reason: ' || p_reason, auth.uid());
end;
$function$;
