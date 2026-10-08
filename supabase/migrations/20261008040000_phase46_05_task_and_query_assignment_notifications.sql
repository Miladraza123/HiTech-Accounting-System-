-- Phase 46.05 — Task assignment notifications + Accept/Complete flow
-- (mirrors dispatch_go_aheads exactly), and the same Accept/Complete +
-- notification mechanism for a Query handed off to someone else (e.g. an
-- Office employee creating a Query, then assigning an Engineer/Rider to
-- go cost it on-site) — Query itself has no such delegation today
-- (responsible_user_id is always whoever created it).

-- ============================================================
-- Part 1: Tasks — Accept step + notifications
-- ============================================================
alter table public.tasks add column accepted_at timestamptz;
alter table public.tasks add column accepted_by uuid references auth.users(id);

alter table public.tasks drop constraint tasks_status_check;
alter table public.tasks add constraint tasks_status_check check (status in ('Open', 'Accepted', 'Done', 'Cancelled'));

create or replace function public.fn_create_task(
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
set search_path = public
as $$
declare
  v_task_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Task title is required.';
  end if;
  if p_priority not in ('Low','Medium','High') then
    raise exception 'Priority must be Low, Medium, or High.';
  end if;
  if not exists (select 1 from public.profiles where id = p_assigned_to) then
    raise exception 'Assigned user not found.';
  end if;

  insert into public.tasks (title, description, related_table, related_id, assigned_to, priority, due_date, created_by)
  values (trim(p_title), p_description, p_related_table, p_related_id, p_assigned_to, p_priority, p_due_date, auth.uid())
  returning id into v_task_id;

  if p_assigned_to <> auth.uid() then
    insert into public.notifications (recipient_user_id, type, title, description, href, related_table, related_id)
    values (p_assigned_to, 'task_assigned', 'New Task — ' || trim(p_title), 'Accept to confirm you are taking this on.', '/tasks/' || v_task_id, 'tasks', v_task_id);
  end if;

  return v_task_id;
end;
$$;

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
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

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
  on conflict (id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.tasks where id = p_id;
  else
    if p_assigned_to <> auth.uid() then
      insert into public.notifications (recipient_user_id, type, title, description, href, related_table, related_id)
      values (p_assigned_to, 'task_assigned', 'New Task — ' || trim(p_title), 'Accept to confirm you are taking this on.', '/tasks/' || v_id, 'tasks', v_id);
    end if;
  end if;

  return v_id;
end;
$$;

-- New: assignee (or Owner) accepts the task, notifies the creator back.
create or replace function public.fn_accept_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
  v_my_name text;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'Task not found.';
  end if;
  if not (public.is_owner() or v_task.assigned_to = auth.uid()) then
    raise exception 'Only the assignee or Owner can accept this task.';
  end if;
  if v_task.status <> 'Open' then
    raise exception 'Only an Open task can be accepted (currently: %).', v_task.status;
  end if;

  update public.tasks
  set status = 'Accepted', accepted_at = now(), accepted_by = auth.uid(), updated_by = auth.uid()
  where id = p_task_id;

  if v_task.created_by is not null and v_task.created_by <> auth.uid() then
    select full_name into v_my_name from public.profiles where id = auth.uid();
    insert into public.notifications (recipient_user_id, type, title, description, href, related_table, related_id)
    values (
      v_task.created_by, 'task_accepted', 'Accepted — ' || v_task.title,
      coalesce(v_my_name, 'Someone') || ' accepted this task.', '/tasks/' || p_task_id, 'tasks', p_task_id
    );
  end if;
end;
$$;

create or replace function public.fn_complete_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
  v_my_name text;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'Task not found.';
  end if;
  if not (public.is_owner() or v_task.created_by = auth.uid() or v_task.assigned_to = auth.uid()) then
    raise exception 'Only the assignee, task creator, or Owner can complete it.';
  end if;
  if v_task.status <> 'Accepted' then
    raise exception 'Only an Accepted task can be completed — accept it first (currently: %).', v_task.status;
  end if;

  update public.tasks
  set status = 'Done', completed_at = now(), completed_by = auth.uid(), updated_by = auth.uid()
  where id = p_task_id;

  if v_task.created_by is not null and v_task.created_by <> auth.uid() then
    select full_name into v_my_name from public.profiles where id = auth.uid();
    insert into public.notifications (recipient_user_id, type, title, description, href, related_table, related_id)
    values (
      v_task.created_by, 'task_completed', 'Completed — ' || v_task.title,
      coalesce(v_my_name, 'Someone') || ' marked this task done.', '/tasks/' || p_task_id, 'tasks', p_task_id
    );
  end if;
end;
$$;

create or replace function public.fn_reopen_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'Task not found.';
  end if;
  if not (public.is_owner() or v_task.created_by = auth.uid() or v_task.assigned_to = auth.uid()) then
    raise exception 'Only the assignee, the task creator, or the Owner can reopen it.';
  end if;
  if v_task.status = 'Open' then
    raise exception 'Task is already Open.';
  end if;

  update public.tasks
  set status = 'Open', accepted_at = null, accepted_by = null, completed_at = null, completed_by = null, cancel_reason = null, updated_by = auth.uid()
  where id = p_task_id;
end;
$$;

create or replace function public.fn_update_task(
  p_task_id uuid,
  p_title text,
  p_assigned_to uuid,
  p_description text default null,
  p_due_date date default null,
  p_priority text default 'Medium'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'Task not found.';
  end if;
  if not (public.is_owner() or v_task.created_by = auth.uid()) then
    raise exception 'Only the task creator or the Owner can edit it.';
  end if;
  if v_task.status <> 'Open' then
    raise exception 'Only Open tasks can be edited — reopen it first.';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Task title is required.';
  end if;
  if p_priority not in ('Low','Medium','High') then
    raise exception 'Priority must be Low, Medium, or High.';
  end if;
  if not exists (select 1 from public.profiles where id = p_assigned_to) then
    raise exception 'Assigned user not found.';
  end if;

  update public.tasks
  set title = trim(p_title), description = p_description, due_date = p_due_date,
      priority = p_priority, assigned_to = p_assigned_to, updated_by = auth.uid()
  where id = p_task_id;

  if p_assigned_to <> v_task.assigned_to and p_assigned_to <> auth.uid() then
    insert into public.notifications (recipient_user_id, type, title, description, href, related_table, related_id)
    values (p_assigned_to, 'task_assigned', 'Reassigned to you — ' || trim(p_title), 'Accept to confirm you are taking this on.', '/tasks/' || p_task_id, 'tasks', p_task_id);
  end if;
end;
$$;

-- ============================================================
-- Part 2: Query assignment (Office -> Engineer/Rider costing) —
-- Accept/Complete + notifications, same shape as dispatch_go_aheads.
-- Query itself is untouched (status, responsible_user_id): this is a
-- separate delegation record, not a replacement for either.
-- ============================================================
create table public.query_assignments (
  id uuid primary key default gen_random_uuid(),
  query_id uuid not null references public.queries(id),
  assigned_by uuid not null references auth.users(id),
  assigned_to uuid not null references auth.users(id),
  status text not null default 'Pending' check (status in ('Pending', 'Accepted', 'Completed')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz
);
create index idx_qa_query on public.query_assignments(query_id);
create index idx_qa_assigned_to on public.query_assignments(assigned_to, status);

alter table public.query_assignments enable row level security;
-- Operational, not financial — same "everyone reads" pattern dispatch_go_aheads uses.
create policy p_select on public.query_assignments for select to authenticated using (true);
create policy p_insert on public.query_assignments for insert to authenticated
  with check (public.is_owner() or public.has_role('sales'));
create policy p_update on public.query_assignments for update to authenticated
  using (assigned_to = (select auth.uid()) or public.is_owner())
  with check (assigned_to = (select auth.uid()) or public.is_owner());

create or replace function public.fn_create_query_assignment(p_query_id uuid, p_assigned_to uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query record;
  v_assignment_id uuid;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can assign a Query.';
  end if;

  select * into v_query from public.queries where id = p_query_id;
  if v_query.id is null then
    raise exception 'Query not found.';
  end if;
  if not exists (select 1 from public.profiles where id = p_assigned_to) then
    raise exception 'Assigned user not found.';
  end if;

  insert into public.query_assignments (query_id, assigned_by, assigned_to)
  values (p_query_id, auth.uid(), p_assigned_to)
  returning id into v_assignment_id;

  insert into public.notifications (recipient_user_id, type, title, description, href, related_table, related_id)
  values (
    p_assigned_to, 'query_assigned', 'Query Assigned — ' || v_query.query_no,
    'Accept to confirm you are taking this on.', '/queries/' || p_query_id, 'queries', p_query_id
  );

  return v_assignment_id;
end;
$$;

create or replace function public.fn_accept_query_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qa record;
  v_query record;
  v_my_name text;
begin
  select * into v_qa from public.query_assignments where id = p_assignment_id for update;
  if v_qa.id is null then
    raise exception 'Assignment not found.';
  end if;
  if not (v_qa.assigned_to = auth.uid() or public.is_owner()) then
    raise exception 'Only the assignee can accept this.';
  end if;
  if v_qa.status <> 'Pending' then
    raise exception 'This assignment is not Pending (currently: %).', v_qa.status;
  end if;

  update public.query_assignments set status = 'Accepted', accepted_at = now() where id = p_assignment_id;

  select * into v_query from public.queries where id = v_qa.query_id;
  select full_name into v_my_name from public.profiles where id = v_qa.assigned_to;

  insert into public.notifications (recipient_user_id, type, title, description, href, related_table, related_id)
  values (
    v_qa.assigned_by, 'query_assignment_accepted', 'Accepted — ' || coalesce(v_query.query_no, ''),
    coalesce(v_my_name, 'Someone') || ' accepted this Query.', '/queries/' || v_qa.query_id, 'queries', v_qa.query_id
  );
end;
$$;

create or replace function public.fn_complete_query_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qa record;
  v_query record;
  v_my_name text;
begin
  select * into v_qa from public.query_assignments where id = p_assignment_id for update;
  if v_qa.id is null then
    raise exception 'Assignment not found.';
  end if;
  if not (v_qa.assigned_to = auth.uid() or public.is_owner()) then
    raise exception 'Only the assignee can complete this.';
  end if;
  if v_qa.status <> 'Accepted' then
    raise exception 'This assignment is not Accepted (currently: %).', v_qa.status;
  end if;

  update public.query_assignments set status = 'Completed', completed_at = now() where id = p_assignment_id;

  select * into v_query from public.queries where id = v_qa.query_id;
  select full_name into v_my_name from public.profiles where id = v_qa.assigned_to;

  insert into public.notifications (recipient_user_id, type, title, description, href, related_table, related_id)
  values (
    v_qa.assigned_by, 'query_assignment_completed', 'Completed — ' || coalesce(v_query.query_no, ''),
    coalesce(v_my_name, 'Someone') || ' completed this Query.', '/queries/' || v_qa.query_id, 'queries', v_qa.query_id
  );
end;
$$;

revoke execute on function public.fn_accept_task(uuid) from public, anon;
grant execute on function public.fn_accept_task(uuid) to authenticated;
revoke execute on function public.fn_create_query_assignment(uuid, uuid) from public, anon;
grant execute on function public.fn_create_query_assignment(uuid, uuid) to authenticated;
revoke execute on function public.fn_accept_query_assignment(uuid) from public, anon;
grant execute on function public.fn_accept_query_assignment(uuid) to authenticated;
revoke execute on function public.fn_complete_query_assignment(uuid) from public, anon;
grant execute on function public.fn_complete_query_assignment(uuid) to authenticated;
