-- Phase 29.02 — Master Offline-First Roadmap, Phase 2: offline-first CREATE
-- for Quotation (Rev-0) and Sales Order.
--
-- Audit finding that changed this phase's original scope: unlike the plan
-- document's initial assumption, `fn_create_sales_order` has NO server-side
-- credit-limit check at all today — the only credit-limit signal anywhere
-- in the app is a purely informational warning computed client-side on the
-- New Sales Order page itself (see (app)/sales-orders/new/page.tsx's
-- `creditWarning`), which explicitly says "this is informational only, the
-- order can still proceed." So there is no "credit exceeded at sync"
-- business outcome to design for here — confirmed by reading the actual
-- function body, not assumed from the plan.
--
-- Same idempotent-create pattern as Phase 1/Query/Task: the browser
-- generates the row's UUID before going online; safe to call twice with
-- the same p_id. Both documents are pure creation (no stock posting, no
-- financial commitment) — genuinely low financial risk, same as Query.
--
-- Reachability constraint (documented, not solved here — matches the
-- exact same constraint already noted for Query/Task's own offline
-- create): both /quotations/new and /sales-orders/new are Server
-- Component pages that live-fetch their parent record (the Query, the
-- Quotation) by id and 404 if it isn't found. A parent that was ITSELF
-- created offline and not yet synced does not exist server-side yet, so
-- there is no way to even reach either of these forms for such a parent
-- while still offline — exactly like "Query/Task today can only reference
-- an existing, already-synced Party" in the original Phase 0 audit. This
-- is a structural page-architecture constraint, not something either RPC
-- below can work around; the `dependsOn` / temp-ID mapping infrastructure
-- built in Phase 0 remains available for a future phase that changes how
-- these pages source their parent record, but wiring it here today would
-- be untestable dead code for a scenario the current UI cannot produce.

create or replace function public.fn_create_quotation_idempotent(
  p_id uuid,
  p_query_id uuid,
  p_terms text,
  p_validity_date date,
  p_delivery_terms text,
  p_payment_terms text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party_id uuid;
  v_existing uuid;
  v_revision_id uuid;
  v_quotation_no text;
  v_totals record;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can create a Quotation.';
  end if;

  select id into v_existing from public.quotations where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  select party_id into v_party_id from public.queries where id = p_query_id;
  if v_party_id is null then
    raise exception 'Query not found.';
  end if;

  select public.fn_get_next_number('QTN') into v_quotation_no;

  insert into public.quotations (id, quotation_no, query_id, party_id, responsible_user_id, status)
  values (p_id, v_quotation_no, p_query_id, v_party_id, auth.uid(), 'Draft')
  -- Belt-and-suspenders against a genuine race (two near-simultaneous
  -- calls with the same id): the primary key constraint itself decides,
  -- atomically, which insert (if any) actually happens.
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    -- Lost the race to a concurrent identical call — the winner already
    -- created (or is creating) the revision/lines below; never insert a
    -- second revision for the same quotation id.
    select id into v_existing from public.quotations where id = p_id;
    return v_existing;
  end if;

  insert into public.quotation_revisions (quotation_id, rev_no, terms, validity_date, delivery_terms, payment_terms, is_current, created_by)
  values (p_id, 0, p_terms, p_validity_date, p_delivery_terms, p_payment_terms, true, auth.uid())
  returning id into v_revision_id;

  select * into v_totals from public._fn_insert_quotation_lines(v_revision_id, p_lines);

  update public.quotation_revisions
    set subtotal = v_totals.subtotal, tax_total = v_totals.tax_total, grand_total = v_totals.grand_total
    where id = v_revision_id;

  update public.queries set status = 'Quoted' where id = p_query_id and status = 'Open';

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', p_query_id, 'system', 'Quotation ' || v_quotation_no || ' (Rev-0) created.', auth.uid());

  return p_id;
end;
$$;

revoke execute on function public.fn_create_quotation_idempotent(uuid, uuid, text, date, text, text, jsonb) from public, anon;
grant execute on function public.fn_create_quotation_idempotent(uuid, uuid, text, date, text, text, jsonb) to authenticated;


create or replace function public.fn_create_sales_order_idempotent(
  p_id uuid,
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
  v_existing uuid;
  v_so_no text;
  v_line jsonb;
  v_idx int := 0;
  v_dup_count int;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can create a Sales Order.';
  end if;

  select id into v_existing from public.sales_orders where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_business_line not in ('material_supply','fabrication') then
    raise exception 'Business line must be material_supply or fabrication.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'A Sales Order needs at least one line.';
  end if;

  select query_id, party_id into v_query_id, v_party_id from public.quotations where id = p_quotation_id;
  if v_party_id is null then
    raise exception 'Quotation not found.';
  end if;

  select count(*) into v_dup_count
    from public.sales_orders
    where party_id = v_party_id and client_po_number = p_client_po_number;

  -- Same DUPLICATE_PO business rule as the online path
  -- (fn_create_sales_order) — the offline queue's own retry classifier
  -- treats this as a permanent failure (no PG error code -> raised as
  -- P0001, not in the retryable set) and surfaces it via lastError rather
  -- than retrying blindly; resubmitting with p_confirm_duplicate = true
  -- (same as the online "Proceed Anyway" button) requires the user to
  -- have already made that choice before going offline, since the queue
  -- itself has no interactive confirmation step mid-sync.
  if v_dup_count > 0 and not p_confirm_duplicate then
    raise exception 'DUPLICATE_PO';
  end if;

  select public.fn_get_next_number('SO') into v_so_no;

  insert into public.sales_orders
    (id, so_no, quotation_id, query_id, party_id, client_po_number, po_date, delivery_schedule,
     payment_terms, business_line, responsible_user_id, created_by)
  values
    (p_id, v_so_no, p_quotation_id, v_query_id, v_party_id, p_client_po_number, p_po_date, p_delivery_schedule,
     p_payment_terms, p_business_line, auth.uid(), auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    -- Lost the race to a concurrent identical call — never insert a
    -- second set of lines for the same sales order id.
    select id into v_existing from public.sales_orders where id = p_id;
    return v_existing;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.sales_order_lines (sales_order_id, item_id, description, ordered_qty, unit, rate, tax_pct, sort_order)
    values (
      p_id,
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

  perform public._fn_recalc_so_totals(p_id);

  update public.quotations set status = 'Accepted' where id = p_quotation_id and status in ('Draft','Sent');
  update public.queries set status = 'Won' where id = v_query_id;

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', v_query_id, 'system', 'Sales Order ' || v_so_no || ' created (Client PO: ' || p_client_po_number || ').', auth.uid());

  return p_id;
end;
$$;

revoke execute on function public.fn_create_sales_order_idempotent(uuid, uuid, text, date, date, text, text, jsonb, boolean) from public, anon;
grant execute on function public.fn_create_sales_order_idempotent(uuid, uuid, text, date, date, text, text, jsonb, boolean) to authenticated;
