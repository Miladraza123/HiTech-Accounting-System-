-- Phase 22.01 — Offline-first Create for Queries (pilot).
--
-- Query is the safest possible pilot for offline record creation: it's a
-- single-row insert (no line items, no linked accounting entries, no
-- stock/credit-limit checks), and it's the very first document in the
-- whole business workflow. This is deliberately NOT rolled out to every
-- document type yet — Quotation/Sales Order/Invoice/etc. are multi-row,
-- multi-RPC transactions with real-time stock/credit checks that cannot
-- safely be evaluated offline; extending this pattern to them needs
-- separate, per-document design work.
--
-- The core idea: the browser generates the row's UUID *before* going
-- online (crypto.randomUUID()), so two different offline users can never
-- collide on the same id — Postgres's own primary key guarantees that.
-- The human-facing sequential number (QRY-0001, via fn_get_next_number)
-- can only ever be assigned once, by the server, at the moment the row
-- is actually created — never offline, never guessed by the client.
--
-- fn_create_query_idempotent is safe to call more than once with the
-- same p_id (e.g. the client retries a sync after a dropped connection
-- but the first attempt actually succeeded): the second call finds the
-- row already exists and simply returns its id — no duplicate row, no
-- second QRY-number consumed.
create or replace function public.fn_create_query_idempotent(
  p_id uuid,
  p_party_id uuid,
  p_requirement text,
  p_source text,
  p_query_date date,
  p_next_followup_at date,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query_no text;
  v_id uuid;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can create a Query.';
  end if;

  -- Idempotency check FIRST, before consuming a QRY-number: if this
  -- exact client-generated id already made it to the server, return the
  -- existing row rather than creating a duplicate or wasting a number.
  select id into v_id from public.queries where id = p_id;
  if v_id is not null then
    return v_id;
  end if;

  if p_party_id is null then
    raise exception 'Client is required.';
  end if;
  if coalesce(trim(p_requirement), '') = '' then
    raise exception 'Requirement is required.';
  end if;

  select public.fn_get_next_number('QRY') into v_query_no;

  insert into public.queries (id, query_no, query_date, party_id, requirement, source, responsible_user_id, next_followup_at, notes, created_by)
  values (
    p_id,
    v_query_no,
    coalesce(p_query_date, current_date),
    p_party_id,
    p_requirement,
    p_source,
    auth.uid(),
    p_next_followup_at,
    p_notes,
    auth.uid()
  )
  -- Belt-and-suspenders against a genuine race (two near-simultaneous
  -- calls with the same id): the primary key constraint itself decides,
  -- atomically, which insert (if any) actually happens.
  on conflict (id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.queries where id = p_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.fn_create_query_idempotent(uuid, uuid, text, text, date, date, text) from public, anon;
grant execute on function public.fn_create_query_idempotent(uuid, uuid, text, text, date, date, text) to authenticated;
