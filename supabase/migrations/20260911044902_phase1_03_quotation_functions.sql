-- Shared helper: insert lines for a revision and return computed totals
create or replace function public._fn_insert_quotation_lines(p_revision_id uuid, p_lines jsonb)
returns table(subtotal numeric, tax_total numeric, grand_total numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_idx int := 0;
  v_subtotal numeric := 0;
  v_tax numeric := 0;
begin
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Quotation mein kam az kam ek line honi chahiye.';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.quotation_lines (revision_id, item_id, description, qty, unit, rate, tax_pct, sort_order)
    values (
      p_revision_id,
      nullif(v_line->>'item_id','')::uuid,
      v_line->>'description',
      (v_line->>'qty')::numeric,
      nullif(v_line->>'unit',''),
      (v_line->>'rate')::numeric,
      coalesce((v_line->>'tax_pct')::numeric, 0),
      v_idx
    );
    v_subtotal := v_subtotal + round((v_line->>'qty')::numeric * (v_line->>'rate')::numeric, 2);
    v_tax := v_tax + round((v_line->>'qty')::numeric * (v_line->>'rate')::numeric * coalesce((v_line->>'tax_pct')::numeric, 0) / 100, 2);
    v_idx := v_idx + 1;
  end loop;

  return query select v_subtotal, v_tax, v_subtotal + v_tax;
end;
$$;

-- Create a brand-new Quotation (Rev-0) from a Query
create or replace function public.fn_create_quotation(
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
  v_quotation_id uuid;
  v_revision_id uuid;
  v_quotation_no text;
  v_totals record;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Sirf Owner ya Sales Quotation bana sakte hain.';
  end if;

  select party_id into v_party_id from public.queries where id = p_query_id;
  if v_party_id is null then
    raise exception 'Query nahi mili.';
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
  values ('queries', p_query_id, 'system', 'Quotation ' || v_quotation_no || ' (Rev-0) banai gayi.', auth.uid());

  return v_quotation_id;
end;
$$;

-- Edit the current revision in place — allowed ONLY while still Draft
create or replace function public.fn_update_draft_quotation(
  p_quotation_id uuid,
  p_terms text,
  p_validity_date date,
  p_delivery_terms text,
  p_payment_terms text,
  p_lines jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_revision_id uuid;
  v_totals record;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Sirf Owner ya Sales Quotation edit kar sakte hain.';
  end if;

  select status into v_status from public.quotations where id = p_quotation_id for update;
  if v_status is null then
    raise exception 'Quotation nahi mili.';
  end if;
  if v_status <> 'Draft' then
    raise exception 'Yeh Quotation Sent ho chuki hai — badlaav ke liye nayi Revision banayen.';
  end if;

  select id into v_revision_id from public.quotation_revisions
    where quotation_id = p_quotation_id and is_current limit 1;

  update public.quotation_revisions
    set terms = p_terms, validity_date = p_validity_date,
        delivery_terms = p_delivery_terms, payment_terms = p_payment_terms
    where id = v_revision_id;

  delete from public.quotation_lines where revision_id = v_revision_id;

  select * into v_totals from public._fn_insert_quotation_lines(v_revision_id, p_lines);

  update public.quotation_revisions
    set subtotal = v_totals.subtotal, tax_total = v_totals.tax_total, grand_total = v_totals.grand_total
    where id = v_revision_id;
end;
$$;

-- Mark a Draft quotation as Sent — after this, edits require a new revision
create or replace function public.fn_mark_quotation_sent(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query_id uuid;
  v_quotation_no text;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Sirf Owner ya Sales yeh kar sakte hain.';
  end if;

  update public.quotations set status = 'Sent'
    where id = p_quotation_id and status = 'Draft'
    returning query_id, quotation_no into v_query_id, v_quotation_no;

  if v_query_id is null then
    raise exception 'Sirf Draft Quotation ko Sent mark kiya ja sakta hai.';
  end if;

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', v_query_id, 'system', 'Quotation ' || v_quotation_no || ' client ko bhej di gayi.', auth.uid());
end;
$$;

-- Create a new revision (Rev-N+1) — old revision stays untouched forever
create or replace function public.fn_create_quotation_revision(
  p_quotation_id uuid,
  p_reason text,
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
  v_query_id uuid;
  v_quotation_no text;
  v_next_rev int;
  v_revision_id uuid;
  v_totals record;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Sirf Owner ya Sales Revision bana sakte hain.';
  end if;

  select query_id, quotation_no into v_query_id, v_quotation_no
    from public.quotations where id = p_quotation_id for update;
  if v_query_id is null then
    raise exception 'Quotation nahi mili.';
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
    'Quotation ' || v_quotation_no || ' Rev-' || v_next_rev || ' banai gayi. Wajah: ' || coalesce(p_reason, '-'),
    auth.uid());

  return v_revision_id;
end;
$$;

-- Query status: manual transitions (Lost / OnHold / reopen to Open)
create or replace function public.fn_set_query_status(p_query_id uuid, p_status text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Sirf Owner ya Sales status badal sakte hain.';
  end if;
  if p_status not in ('Open','Quoted','Won','Lost','OnHold') then
    raise exception 'Ghalat status: %', p_status;
  end if;

  update public.queries set status = p_status where id = p_query_id;

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('queries', p_query_id, 'status_change', coalesce(p_note, 'Status: ' || p_status), auth.uid());
end;
$$;

revoke execute on function public._fn_insert_quotation_lines(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.fn_create_quotation(uuid, text, date, text, text, jsonb) from public, anon;
revoke execute on function public.fn_update_draft_quotation(uuid, text, date, text, text, jsonb) from public, anon;
revoke execute on function public.fn_mark_quotation_sent(uuid) from public, anon;
revoke execute on function public.fn_create_quotation_revision(uuid, text, text, date, text, text, jsonb) from public, anon;
revoke execute on function public.fn_set_query_status(uuid, text, text) from public, anon;

grant execute on function public.fn_create_quotation(uuid, text, date, text, text, jsonb) to authenticated;
grant execute on function public.fn_update_draft_quotation(uuid, text, date, text, text, jsonb) to authenticated;
grant execute on function public.fn_mark_quotation_sent(uuid) to authenticated;
grant execute on function public.fn_create_quotation_revision(uuid, text, text, date, text, text, jsonb) to authenticated;
grant execute on function public.fn_set_query_status(uuid, text, text) to authenticated;
