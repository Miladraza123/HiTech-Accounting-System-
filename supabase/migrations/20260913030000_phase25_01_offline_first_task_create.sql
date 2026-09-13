-- Phase 25: extend the offline-first create pattern (Phase 22, Query) to
-- a second document type. Task is, if anything, an even safer candidate
-- than Query: a single-row insert, no line items, no stock/credit
-- checks, and — unlike Query — no sequential document number at all
-- (tasks has no task_no/fn_get_next_number dependency), so there isn't
-- even a numbering race to worry about.
--
-- Same idempotency shape as fn_create_query_idempotent: the client
-- generates the row's real, permanent uuid before ever going online: a
-- retried sync (or a genuine race between two calls with the same id)
-- can never create a duplicate — it just returns the existing row.
create or replace function public.fn_create_task_idempotent(
  p_id uuid,
  p_title text,
  p_assigned_to uuid,
  p_description text default null,
  p_due_date date default null,
  p_priority text default 'Medium',
  p_related_table text default null,
  p_related_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  -- Idempotency check first: if this exact client-generated id already
  -- made it to the server (a retried sync after a dropped connection),
  -- return the existing row instead of creating a duplicate.
  select id into v_id from public.tasks where id = p_id;
  if v_id is not null then
    return v_id;
  end if;

  if coalesce(trim(p_title), '') = '' then
    raise exception 'Task title is required.';
  end if;
  if p_priority not in ('Low', 'Medium', 'High') then
    raise exception 'Priority must be Low, Medium, or High.';
  end if;
  if not exists (select 1 from public.profiles where id = p_assigned_to) then
    raise exception 'Assigned user not found.';
  end if;

  insert into public.tasks (id, title, description, related_table, related_id, assigned_to, priority, due_date, created_by)
  values (p_id, trim(p_title), p_description, p_related_table, p_related_id, p_assigned_to, p_priority, p_due_date, auth.uid())
  -- Belt-and-suspenders against a genuine race: the primary key
  -- constraint itself decides, atomically, which insert (if any) wins.
  on conflict (id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.tasks where id = p_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.fn_create_task_idempotent(uuid, text, uuid, text, date, text, text, uuid) from public, anon;
grant execute on function public.fn_create_task_idempotent(uuid, text, uuid, text, date, text, text, uuid) to authenticated;
