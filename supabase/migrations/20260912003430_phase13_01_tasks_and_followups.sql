-- ============================================================
-- Phase 13 part A: Tasks & Follow-ups (prompt's task/follow-up
-- reminder ask). A dedicated, completable task list — distinct from the
-- existing free-form activity_timeline notes (which already carry an
-- optional next_followup_at per note, used on Queries/Jobs today): those
-- stay as a running log, this is an explicit assignable/closeable to-do
-- that can optionally link to any order/job/party/etc via a generic
-- (related_table, related_id) pair, same dimension pattern as
-- activity_timeline.owner_table/owner_id.
-- ============================================================
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  related_table text,
  related_id uuid,
  assigned_to uuid not null references public.profiles(id),
  priority text not null default 'Medium' check (priority in ('Low','Medium','High')),
  due_date date,
  status text not null default 'Open' check (status in ('Open','Done','Cancelled')),
  completed_at timestamptz,
  completed_by uuid references auth.users(id),
  cancel_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

comment on table public.tasks is 'Assignable, closeable follow-up/action tasks. related_table/related_id optionally point at any entity (sales_orders, purchase_orders, jobs, parties, queries, quotations, delivery_challans, invoices, supplier_bills) — same generic-dimension pattern as activity_timeline.owner_table/owner_id.';

create index idx_tasks_assigned_to on public.tasks(assigned_to);
create index idx_tasks_status on public.tasks(status);
create index idx_tasks_due_date on public.tasks(due_date);
create index idx_tasks_related on public.tasks(related_table, related_id);

create trigger trg_audit after insert or delete or update on public.tasks for each row execute function fn_audit_row();
create trigger trg_updated_at before update on public.tasks for each row execute function fn_set_updated_at();

alter table public.tasks enable row level security;
create policy p_select on public.tasks for select using (true);
create policy p_insert on public.tasks for insert with check (created_by = auth.uid());
create policy p_update on public.tasks for update
  using (public.is_owner() or created_by = auth.uid() or assigned_to = auth.uid())
  with check (public.is_owner() or created_by = auth.uid() or assigned_to = auth.uid());

-- ---- Functions ----

create or replace function public.fn_create_task(
  p_title text, p_assigned_to uuid, p_description text default null, p_due_date date default null,
  p_priority text default 'Medium', p_related_table text default null, p_related_id uuid default null
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_task_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Task title zaroori hai.';
  end if;
  if p_priority not in ('Low','Medium','High') then
    raise exception 'Priority Low, Medium ya High honi chahiye.';
  end if;
  if not exists (select 1 from public.profiles where id = p_assigned_to) then
    raise exception 'Assigned user nahi mila.';
  end if;

  insert into public.tasks (title, description, related_table, related_id, assigned_to, priority, due_date, created_by)
  values (trim(p_title), p_description, p_related_table, p_related_id, p_assigned_to, p_priority, p_due_date, auth.uid())
  returning id into v_task_id;

  return v_task_id;
end;
$function$;

create or replace function public.fn_update_task(
  p_task_id uuid, p_title text, p_assigned_to uuid, p_description text default null,
  p_due_date date default null, p_priority text default 'Medium'
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_task record;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'Task nahi mili.';
  end if;
  if not (public.is_owner() or v_task.created_by = auth.uid()) then
    raise exception 'Sirf task banane wala ya Owner isay edit kar sakta hai.';
  end if;
  if v_task.status <> 'Open' then
    raise exception 'Sirf Open task edit ho sakti hai — pehle reopen karen.';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Task title zaroori hai.';
  end if;
  if p_priority not in ('Low','Medium','High') then
    raise exception 'Priority Low, Medium ya High honi chahiye.';
  end if;
  if not exists (select 1 from public.profiles where id = p_assigned_to) then
    raise exception 'Assigned user nahi mila.';
  end if;

  update public.tasks
  set title = trim(p_title), description = p_description, due_date = p_due_date,
      priority = p_priority, assigned_to = p_assigned_to, updated_by = auth.uid()
  where id = p_task_id;
end;
$function$;

create or replace function public.fn_complete_task(p_task_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_task record;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'Task nahi mili.';
  end if;
  if not (public.is_owner() or v_task.created_by = auth.uid() or v_task.assigned_to = auth.uid()) then
    raise exception 'Sirf assignee, task banane wala, ya Owner isay complete kar sakta hai.';
  end if;
  if v_task.status <> 'Open' then
    raise exception 'Sirf Open task complete ho sakti hai.';
  end if;

  update public.tasks
  set status = 'Done', completed_at = now(), completed_by = auth.uid(), updated_by = auth.uid()
  where id = p_task_id;
end;
$function$;

create or replace function public.fn_reopen_task(p_task_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_task record;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'Task nahi mili.';
  end if;
  if not (public.is_owner() or v_task.created_by = auth.uid() or v_task.assigned_to = auth.uid()) then
    raise exception 'Sirf assignee, task banane wala, ya Owner isay reopen kar sakta hai.';
  end if;
  if v_task.status = 'Open' then
    raise exception 'Task pehle se Open hai.';
  end if;

  update public.tasks
  set status = 'Open', completed_at = null, completed_by = null, cancel_reason = null, updated_by = auth.uid()
  where id = p_task_id;
end;
$function$;

create or replace function public.fn_cancel_task(p_task_id uuid, p_reason text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_task record;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'Task nahi mili.';
  end if;
  if not (public.is_owner() or v_task.created_by = auth.uid()) then
    raise exception 'Sirf task banane wala ya Owner isay cancel kar sakta hai.';
  end if;
  if v_task.status <> 'Open' then
    raise exception 'Sirf Open task cancel ho sakti hai.';
  end if;

  update public.tasks
  set status = 'Cancelled', cancel_reason = p_reason, updated_by = auth.uid()
  where id = p_task_id;
end;
$function$;
