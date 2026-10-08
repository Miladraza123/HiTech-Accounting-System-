-- Phase 46.04 — Direct Sales Order (a client PO that arrives with no prior
-- RFQ/Quotation at all — e.g. by WhatsApp or phone, not every sale starts
-- with a Query). The Document Trail (Invoice -> ... -> Query) and
-- sales_orders.query_id/quotation_id (both NOT NULL) assume every Sales
-- Order traces back to a Query and Quotation, so this generates both
-- automatically behind the scenes instead of relaxing that schema — the
-- user only fills in Party + PO details + lines, same single form either
-- way the trail is built.
--
-- Reuses fn_create_sales_order (and _fn_insert_quotation_lines) as-is for
-- everything downstream of the Quotation existing, rather than duplicating
-- that logic — the auto-generated Query/Quotation get the exact same
-- status transitions (Won/Accepted) and duplicate-PO check a normal order
-- would.
create or replace function public.fn_create_direct_sales_order(
  p_party_id uuid,
  p_client_po_number text,
  p_po_date date,
  p_delivery_schedule date,
  p_payment_terms text,
  p_business_line text,
  p_lines jsonb, -- [{item_id?, description, ordered_qty, unit?, rate, tax_pct}] — same shape fn_create_sales_order already takes
  p_confirm_duplicate boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query_id uuid;
  v_quotation_id uuid;
  v_revision_id uuid;
  v_query_no text;
  v_quotation_no text;
  v_quotation_lines jsonb;
  v_totals record;
  v_so_id uuid;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can create a Sales Order.';
  end if;
  if p_party_id is null then
    raise exception 'Select a Client.';
  end if;

  select public.fn_get_next_number('QRY') into v_query_no;
  insert into public.queries (query_no, party_id, requirement, responsible_user_id, status, created_by)
  values (v_query_no, p_party_id, 'Direct PO ' || p_client_po_number || ' — no prior RFQ/Quotation.', auth.uid(), 'Open', auth.uid())
  returning id into v_query_id;

  select public.fn_get_next_number('QTN') into v_quotation_no;
  insert into public.quotations (quotation_no, query_id, party_id, responsible_user_id, status)
  values (v_quotation_no, v_query_id, p_party_id, auth.uid(), 'Draft')
  returning id into v_quotation_id;

  insert into public.quotation_revisions (quotation_id, rev_no, terms, payment_terms, is_current, created_by)
  values (v_quotation_id, 0, 'Generated automatically for a Direct Sales Order — not sent to the client.', p_payment_terms, true, auth.uid())
  returning id into v_revision_id;

  -- _fn_insert_quotation_lines reads each line's quantity under "qty";
  -- fn_create_sales_order (called below, unchanged) reads the SAME p_lines
  -- under "ordered_qty" — this copies the value across so one line shape
  -- from the client satisfies both, without the wrapper's own API leaking
  -- the quotation engine's internal field name.
  select jsonb_agg(line || jsonb_build_object('qty', line->'ordered_qty'))
    into v_quotation_lines
    from jsonb_array_elements(p_lines) as line;

  select * into v_totals from public._fn_insert_quotation_lines(v_revision_id, v_quotation_lines);

  update public.quotation_revisions
    set subtotal = v_totals.subtotal, tax_total = v_totals.tax_total, grand_total = v_totals.grand_total
    where id = v_revision_id;

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', v_query_id, 'system', 'Direct Sales Order: Query + Quotation ' || v_quotation_no || ' generated automatically from client PO ' || p_client_po_number || '.', auth.uid());

  v_so_id := public.fn_create_sales_order(
    v_quotation_id, p_client_po_number, p_po_date, p_delivery_schedule, p_payment_terms, p_business_line, p_lines, p_confirm_duplicate
  );

  return v_so_id;
end;
$$;
