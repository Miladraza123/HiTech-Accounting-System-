-- Phase 62.01: Recurring Tasks (daily / weekly / monthly / yearly reminders that become real Tasks).
--
-- A user saves a recurring task once (title, repeat rule, time). Each day the system turns the rule's
-- occurrences into ordinary rows of the existing `tasks` table (so Accept / Done / Overdue / history all
-- work as they do today). Generation happens when the assigned user opens the app (fn_generate_recurring_tasks,
-- idempotent: one task per rule per date). A day the user did not open the app is filled in on the next
-- visit (up to 31 days back) and shows as Overdue.
--
-- Purely additive: two nullable columns on `tasks`, one new table, three small functions.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table public.recurring_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> '' and char_length(title) <= 200),
  description text,
  assigned_to uuid not null references public.profiles(id),
  priority text not null default 'Medium' check (priority in ('Low', 'Medium', 'High')),
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly', 'yearly')),
  weekdays int[] not null default '{}',                                   -- weekly: 0 = Sunday ... 6 = Saturday
  month_day int check (month_day between 1 and 31),                       -- monthly / yearly
  month int check (month between 1 and 12),                               -- yearly
  due_time time,                                                          -- optional time of day (Karachi)
  start_date date not null default ((now() at time zone 'Asia/Karachi')::date),
  end_date date,
  is_active boolean not null default true,
  last_generated_date date,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_tasks_shape_chk check (
    frequency = 'daily'
    or (frequency = 'weekly' and cardinality(weekdays) > 0)
    or (frequency = 'monthly' and month_day is not null)
    or (frequency = 'yearly' and month_day is not null and month is not null)
  ),
  constraint recurring_tasks_dates_chk check (end_date is null or end_date >= start_date)
);
create index recurring_tasks_user_idx on public.recurring_tasks (assigned_to) where is_active;

alter table public.tasks add column if not exists due_time time;
alter table public.tasks add column if not exists recurring_task_id uuid references public.recurring_tasks(id) on delete set null;
create unique index if not exists tasks_recurring_occurrence_uq on public.tasks (recurring_task_id, due_date) where recurring_task_id is not null;

create trigger trg_updated_at before update on public.recurring_tasks for each row execute function public.fn_set_updated_at();
create trigger trg_audit after insert or update or delete on public.recurring_tasks for each row execute function public.fn_audit_row();

alter table public.recurring_tasks enable row level security;
create policy p_select on public.recurring_tasks for select to authenticated
  using (assigned_to = (select auth.uid()) or created_by = (select auth.uid()) or public.is_owner() or public.has_role('backup'));
revoke all on public.recurring_tasks from anon, authenticated;
grant select on public.recurring_tasks to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Does a rule fall on a date?  (month-end days clamp: day 31 in a 30-day month runs on the 30th)
-- ---------------------------------------------------------------------------
create or replace function public.fn_recurrence_hits(p_frequency text, p_weekdays int[], p_month_day int, p_month int, p_date date)
returns boolean
language sql
immutable
set search_path = public
as $fn$
  select case p_frequency
    when 'daily' then true
    when 'weekly' then extract(dow from p_date)::int = any (p_weekdays)
    when 'monthly' then extract(day from p_date)::int
        = least(p_month_day, extract(day from (date_trunc('month', p_date::timestamp) + interval '1 month - 1 day'))::int)
    when 'yearly' then extract(month from p_date)::int = p_month
      and extract(day from p_date)::int
        = least(p_month_day, extract(day from (date_trunc('month', p_date::timestamp) + interval '1 month - 1 day'))::int)
    else false
  end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Save (create / change) a recurring task
-- ---------------------------------------------------------------------------
create or replace function public.fn_save_recurring_task(
  p_id uuid,
  p_title text,
  p_description text,
  p_assigned_to uuid,
  p_priority text,
  p_frequency text,
  p_weekdays int[],
  p_month_day int,
  p_month int,
  p_due_time time,
  p_start_date date,
  p_end_date date,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_assignee uuid;
  v_wd int[];
  v_old public.recurring_tasks;
  v_id uuid;
  v_start date := coalesce(p_start_date, (now() at time zone 'Asia/Karachi')::date);
begin
  if v_uid is null then
    raise exception 'Sign in required.';
  end if;
  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'Enter a title.';
  end if;
  if char_length(btrim(p_title)) > 200 then
    raise exception 'The title is too long (200 characters at most).';
  end if;
  if p_priority not in ('Low', 'Medium', 'High') or p_priority is null then
    raise exception 'Priority must be Low, Medium or High.';
  end if;
  if p_frequency not in ('daily', 'weekly', 'monthly', 'yearly') or p_frequency is null then
    raise exception 'Choose how often it repeats.';
  end if;
  if p_end_date is not null and p_end_date < v_start then
    raise exception 'The end date cannot be before the start date.';
  end if;

  v_wd := coalesce(array(select distinct w from unnest(coalesce(p_weekdays, '{}')) w order by w), '{}');
  if p_frequency = 'weekly' then
    if cardinality(v_wd) = 0 or exists (select 1 from unnest(v_wd) w where w < 0 or w > 6) then
      raise exception 'Choose at least one day of the week.';
    end if;
  else
    v_wd := '{}';
  end if;
  if p_frequency in ('monthly', 'yearly') and (p_month_day is null or p_month_day < 1 or p_month_day > 31) then
    raise exception 'Choose the day of the month (1 to 31).';
  end if;
  if p_frequency = 'yearly' and (p_month is null or p_month < 1 or p_month > 12) then
    raise exception 'Choose the month.';
  end if;

  v_assignee := coalesce(p_assigned_to, v_uid);
  if v_assignee <> v_uid and not public.is_owner() then
    raise exception 'Only the Owner can set a recurring task for someone else.';
  end if;
  if not exists (select 1 from public.profiles where id = v_assignee) then
    raise exception 'User not found.';
  end if;

  if p_id is null then
    insert into public.recurring_tasks
      (title, description, assigned_to, priority, frequency, weekdays, month_day, month, due_time, start_date, end_date, is_active, created_by)
    values
      (btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), v_assignee, p_priority, p_frequency, v_wd,
       case when p_frequency in ('monthly', 'yearly') then p_month_day end,
       case when p_frequency = 'yearly' then p_month end,
       p_due_time, v_start, p_end_date, coalesce(p_is_active, true), v_uid)
    returning id into v_id;
  else
    select * into v_old from public.recurring_tasks where id = p_id for update;
    if v_old.id is null then
      raise exception 'Recurring task not found.';
    end if;
    if not (public.is_owner() or v_old.assigned_to = v_uid or v_old.created_by = v_uid) then
      raise exception 'You cannot change this recurring task.';
    end if;
    if v_assignee <> v_old.assigned_to and not public.is_owner() then
      raise exception 'Only the Owner can change who a recurring task is for.';
    end if;
    update public.recurring_tasks
    set title = btrim(p_title),
        description = nullif(btrim(coalesce(p_description, '')), ''),
        assigned_to = v_assignee,
        priority = p_priority,
        frequency = p_frequency,
        weekdays = v_wd,
        month_day = case when p_frequency in ('monthly', 'yearly') then p_month_day end,
        month = case when p_frequency = 'yearly' then p_month end,
        due_time = p_due_time,
        start_date = v_start,
        end_date = p_end_date,
        is_active = coalesce(p_is_active, is_active)
    where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end;
$fn$;

-- Switch on / off, or delete (tasks already made from it stay, and just lose the link).
create or replace function public.fn_set_recurring_task_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r public.recurring_tasks;
begin
  select * into r from public.recurring_tasks where id = p_id for update;
  if r.id is null then
    raise exception 'Recurring task not found.';
  end if;
  if not (public.is_owner() or r.assigned_to = auth.uid() or r.created_by = auth.uid()) then
    raise exception 'You cannot change this recurring task.';
  end if;
  update public.recurring_tasks set is_active = coalesce(p_active, false) where id = p_id;
end;
$fn$;

create or replace function public.fn_delete_recurring_task(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r public.recurring_tasks;
begin
  select * into r from public.recurring_tasks where id = p_id for update;
  if r.id is null then
    raise exception 'Recurring task not found.';
  end if;
  if not (public.is_owner() or r.assigned_to = auth.uid() or r.created_by = auth.uid()) then
    raise exception 'You cannot delete this recurring task.';
  end if;
  delete from public.recurring_tasks where id = p_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Turn the signed-in user's rules into tasks for today (and days missed in the last 31)
-- ---------------------------------------------------------------------------
-- Cheap to call on every page: a rule already handled today is skipped by its last_generated_date.
create or replace function public.fn_generate_recurring_tasks()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  r record;
  d date;
  v_from date;
  v_to date;
  v_rows int;
  v_count int := 0;
begin
  if v_uid is null then
    return 0;
  end if;
  for r in
    select * from public.recurring_tasks
    where assigned_to = v_uid and is_active and start_date <= v_today
      and (end_date is null or end_date >= start_date)
      and last_generated_date is distinct from v_today
  loop
    v_from := greatest(r.start_date, coalesce(r.last_generated_date + 1, r.start_date), v_today - 31);
    v_to := least(v_today, coalesce(r.end_date, v_today));
    if v_from <= v_to then
      for d in select g::date from generate_series(v_from, v_to, interval '1 day') g loop
        if public.fn_recurrence_hits(r.frequency, r.weekdays, r.month_day, r.month, d) then
          insert into public.tasks (title, description, assigned_to, priority, due_date, due_time, status, created_by, recurring_task_id)
          values (r.title, r.description, r.assigned_to, r.priority, d, r.due_time, 'Open', coalesce(r.created_by, r.assigned_to), r.id)
          on conflict (recurring_task_id, due_date) where recurring_task_id is not null do nothing;
          get diagnostics v_rows = row_count;
          v_count := v_count + v_rows;
        end if;
      end loop;
    end if;
    update public.recurring_tasks set last_generated_date = v_today where id = r.id;
  end loop;
  return v_count;
end;
$fn$;

revoke all on function public.fn_recurrence_hits(text, int[], int, int, date) from public, anon;
grant execute on function public.fn_recurrence_hits(text, int[], int, int, date) to authenticated;
revoke all on function public.fn_save_recurring_task(uuid, text, text, uuid, text, text, int[], int, int, time, date, date, boolean) from public, anon;
grant execute on function public.fn_save_recurring_task(uuid, text, text, uuid, text, text, int[], int, int, time, date, date, boolean) to authenticated;
revoke all on function public.fn_set_recurring_task_active(uuid, boolean) from public, anon;
grant execute on function public.fn_set_recurring_task_active(uuid, boolean) to authenticated;
revoke all on function public.fn_delete_recurring_task(uuid) from public, anon;
grant execute on function public.fn_delete_recurring_task(uuid) to authenticated;
revoke all on function public.fn_generate_recurring_tasks() from public, anon;
grant execute on function public.fn_generate_recurring_tasks() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Backup / restore: the new table must be restorable
-- ---------------------------------------------------------------------------
do $patch$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public._fn_restore_pk_columns(text)'::regprocedure) into v_def;
  if v_def like '%recurring_tasks%' then
    return;
  end if;
  v_new := replace(v_def, 'else null', E'when ''recurring_tasks'' then array[''id'']\n    else null');
  if v_new = v_def then
    raise exception '_fn_restore_pk_columns patch did not apply';
  end if;
  execute v_new;
end
$patch$;
