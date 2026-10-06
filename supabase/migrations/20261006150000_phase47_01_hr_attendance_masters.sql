-- Phase 47.01: HR / Attendance, part (a): Employees, Policy Groups and
-- effective-dated policy and pay terms.
--
-- Design (agreed with the Owner):
--  * Manual attendance only: a clerk with the new "hr" role (or the Owner)
--    keeps every record here. The clerk's entry is final; there is no
--    approval step.
--  * A Policy Group holds the whole rule set (shift timing, break,
--    late/early rules, overtime, sandwich rule, wager pay cycle, paid
--    leaves). Every change to it is saved as a NEW VERSION with an
--    "effective from" date, so old months keep the rules they were
--    worked under.
--  * An employee's terms (group, daily wager / permanent, pay, and any
--    per-employee rule overrides) are versioned the same way.
--  * Rules for a given day = defaults <- group version in force that day
--    <- that employee's overrides in force that day
--    (fn_hr_rules_for). The later parts (daily grid, salary sheet) read
--    only through that function.
--  * Writes go only through the SECURITY DEFINER fn_hr_* functions below;
--    the tables themselves are read-only to the API.

-- ---------------------------------------------------------------------------
-- 1. Role
-- ---------------------------------------------------------------------------
insert into public.roles (code, name, description)
values ('hr', 'HR / Attendance', 'Employees, attendance policies and daily attendance entry')
on conflict (code) do nothing;

create or replace function public.fn_hr_can_manage()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_owner() or public.has_role('hr');
$$;

create or replace function public.fn_hr_can_read()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_owner() or public.has_role('hr') or public.has_role('accounts') or public.has_role('auditor');
$$;

-- ---------------------------------------------------------------------------
-- 2. Rules: defaults + validation
-- ---------------------------------------------------------------------------
-- Every key a rule set may hold, with the value used when nobody set it.
--  shift_start / shift_end      'HH:MM' (end before start = night shift)
--  working_days                 weekdays worked, 0 = Sunday … 6 = Saturday
--  break_minutes, break_paid    break length, and whether it is paid time
--  late_grace_minutes           late arrival within this is not "late"
--  late_mode                    none | deduct_minutes | count
--  late_count_per_deduction     (count) this many lates in a month …
--  late_deduction_days          … deduct this many days' pay
--  half_day_late_after_minutes  later than this = half day (0 = off)
--  early_grace_minutes          early leaving within this is ignored
--  early_mode                   none | deduct_minutes
--  half_day_below_minutes       worked less than this = half day (0 = off)
--  absent_below_minutes         worked less than this = absent (0 = off)
--  ot_enabled, ot_min_minutes   overtime counts only past this many minutes
--  ot_rate_type, ot_rate        multiplier of the normal minute rate, or a
--                               fixed amount per hour
--  sandwich_rule                an off day between two absences is absent
--  wager_pay_cycle              weekly | fortnightly | monthly
--  wager_week_start             first weekday of a weekly / fortnightly cycle
--  paid_leaves_per_year         paid leave days a permanent employee gets
create or replace function public.fn_hr_default_rules()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'shift_start', '09:00',
    'shift_end', '18:00',
    'working_days', jsonb_build_array(1, 2, 3, 4, 5, 6),
    'break_minutes', 60,
    'break_paid', false,
    'late_grace_minutes', 10,
    'late_mode', 'count',
    'late_count_per_deduction', 3,
    'late_deduction_days', 0.5,
    'half_day_late_after_minutes', 120,
    'early_grace_minutes', 10,
    'early_mode', 'deduct_minutes',
    'half_day_below_minutes', 240,
    'absent_below_minutes', 120,
    'ot_enabled', false,
    'ot_min_minutes', 30,
    'ot_rate_type', 'multiplier',
    'ot_rate', 1.5,
    'sandwich_rule', false,
    'wager_pay_cycle', 'weekly',
    'wager_week_start', 1,
    'paid_leaves_per_year', 12
  );
$$;

-- Checks one rule set and returns it cleaned up.
--  p_full = true  -> a complete set (missing keys are filled from the
--                    defaults, then cross-field checks run)
--  p_full = false -> a per-employee override: only the keys given, no
--                    defaults added
create or replace function public.fn_hr_validate_rules(p_rules jsonb, p_full boolean)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_key text;
  v_val jsonb;
  v_num numeric;
  v_days jsonb;
  v_merged jsonb;
  v_start int;
  v_end int;
  v_shift int;
  v_int_ranges constant jsonb := jsonb_build_object(
    'break_minutes', jsonb_build_array(0, 600),
    'late_grace_minutes', jsonb_build_array(0, 600),
    'late_count_per_deduction', jsonb_build_array(1, 31),
    'half_day_late_after_minutes', jsonb_build_array(0, 1440),
    'early_grace_minutes', jsonb_build_array(0, 600),
    'half_day_below_minutes', jsonb_build_array(0, 1440),
    'absent_below_minutes', jsonb_build_array(0, 1440),
    'ot_min_minutes', jsonb_build_array(0, 1440),
    'wager_week_start', jsonb_build_array(0, 6)
  );
  v_label constant jsonb := jsonb_build_object(
    'shift_start', 'Shift start', 'shift_end', 'Shift end', 'working_days', 'Working days',
    'break_minutes', 'Break minutes', 'break_paid', 'Break paid', 'late_grace_minutes', 'Late grace',
    'late_mode', 'Late policy', 'late_count_per_deduction', 'Lates per deduction',
    'late_deduction_days', 'Days deducted', 'half_day_late_after_minutes', 'Half day if late more than',
    'early_grace_minutes', 'Early leaving grace', 'early_mode', 'Early leaving policy',
    'half_day_below_minutes', 'Half day if worked less than', 'absent_below_minutes', 'Absent if worked less than',
    'ot_enabled', 'Overtime', 'ot_min_minutes', 'Overtime starts after', 'ot_rate_type', 'Overtime rate type',
    'ot_rate', 'Overtime rate', 'sandwich_rule', 'Sandwich rule', 'wager_pay_cycle', 'Wager pay cycle',
    'wager_week_start', 'Pay week starts on', 'paid_leaves_per_year', 'Paid leaves per year'
  );
begin
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then
    raise exception 'Rules must be a JSON object.';
  end if;

  for v_key, v_val in select key, value from jsonb_each(p_rules) loop
    if not (public.fn_hr_default_rules() ? v_key) then
      raise exception 'Unknown policy rule "%".', v_key;
    end if;

    if v_key in ('shift_start', 'shift_end') then
      if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception '% must be a time like 09:00.', v_label ->> v_key;
      end if;
      v_out := v_out || jsonb_build_object(v_key, v_val);

    elsif v_key = 'working_days' then
      if jsonb_typeof(v_val) <> 'array' or jsonb_array_length(v_val) = 0 then
        raise exception 'Pick at least one working day.';
      end if;
      if exists (
        select 1 from jsonb_array_elements(v_val) e
        where jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric not in (0, 1, 2, 3, 4, 5, 6)
      ) then
        raise exception 'Working days must be weekday numbers 0 (Sunday) to 6 (Saturday).';
      end if;
      select jsonb_agg(d order by d) into v_days
      from (select distinct (e #>> '{}')::int as d from jsonb_array_elements(v_val) e) s;
      v_out := v_out || jsonb_build_object(v_key, v_days);

    elsif v_key in ('break_paid', 'ot_enabled', 'sandwich_rule') then
      if jsonb_typeof(v_val) <> 'boolean' then
        raise exception '% must be on or off.', v_label ->> v_key;
      end if;
      v_out := v_out || jsonb_build_object(v_key, v_val);

    elsif v_key = 'late_mode' then
      if (v_val #>> '{}') not in ('none', 'deduct_minutes', 'count') or jsonb_typeof(v_val) <> 'string' then
        raise exception 'Late policy must be none, deduct_minutes or count.';
      end if;
      v_out := v_out || jsonb_build_object(v_key, v_val);

    elsif v_key = 'early_mode' then
      if (v_val #>> '{}') not in ('none', 'deduct_minutes') or jsonb_typeof(v_val) <> 'string' then
        raise exception 'Early leaving policy must be none or deduct_minutes.';
      end if;
      v_out := v_out || jsonb_build_object(v_key, v_val);

    elsif v_key = 'ot_rate_type' then
      if (v_val #>> '{}') not in ('multiplier', 'fixed_per_hour') or jsonb_typeof(v_val) <> 'string' then
        raise exception 'Overtime rate type must be multiplier or fixed_per_hour.';
      end if;
      v_out := v_out || jsonb_build_object(v_key, v_val);

    elsif v_key = 'wager_pay_cycle' then
      if (v_val #>> '{}') not in ('weekly', 'fortnightly', 'monthly') or jsonb_typeof(v_val) <> 'string' then
        raise exception 'Wager pay cycle must be weekly, fortnightly or monthly.';
      end if;
      v_out := v_out || jsonb_build_object(v_key, v_val);

    elsif v_int_ranges ? v_key then
      if jsonb_typeof(v_val) <> 'number' then
        raise exception '% must be a number.', v_label ->> v_key;
      end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num <> trunc(v_num)
         or v_num < (v_int_ranges -> v_key ->> 0)::int
         or v_num > (v_int_ranges -> v_key ->> 1)::int then
        raise exception '% must be a whole number from % to %.',
          v_label ->> v_key, v_int_ranges -> v_key ->> 0, v_int_ranges -> v_key ->> 1;
      end if;
      v_out := v_out || jsonb_build_object(v_key, v_num::int);

    elsif v_key = 'late_deduction_days' then
      if jsonb_typeof(v_val) <> 'number' then
        raise exception 'Days deducted must be a number.';
      end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num <= 0 or v_num > 5 then
        raise exception 'Days deducted must be more than 0 and at most 5.';
      end if;
      v_out := v_out || jsonb_build_object(v_key, round(v_num, 2));

    elsif v_key = 'ot_rate' then
      if jsonb_typeof(v_val) <> 'number' then
        raise exception 'Overtime rate must be a number.';
      end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num <= 0 or v_num > 100000 then
        raise exception 'Overtime rate must be more than 0.';
      end if;
      v_out := v_out || jsonb_build_object(v_key, round(v_num, 4));

    elsif v_key = 'paid_leaves_per_year' then
      if jsonb_typeof(v_val) <> 'number' then
        raise exception 'Paid leaves per year must be a number.';
      end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < 0 or v_num > 365 or v_num * 2 <> trunc(v_num * 2) then
        raise exception 'Paid leaves per year must be 0 to 365, in half days.';
      end if;
      v_out := v_out || jsonb_build_object(v_key, v_num);
    end if;
  end loop;

  if not p_full then
    return v_out;
  end if;

  v_merged := public.fn_hr_default_rules() || v_out;
  perform public.fn_hr_check_rule_set(v_merged);
  return v_merged;
end;
$$;

-- Cross-field checks on a complete rule set (also run on the result of a
-- group version + an employee's overrides, so an override can never make
-- the combined rules contradict themselves).
create or replace function public.fn_hr_check_rule_set(p_rules jsonb)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  v_start int := split_part(p_rules ->> 'shift_start', ':', 1)::int * 60 + split_part(p_rules ->> 'shift_start', ':', 2)::int;
  v_end int := split_part(p_rules ->> 'shift_end', ':', 1)::int * 60 + split_part(p_rules ->> 'shift_end', ':', 2)::int;
  v_shift int;
begin
  if v_start = v_end then
    raise exception 'Shift start and end cannot be the same time.';
  end if;
  v_shift := case when v_end > v_start then v_end - v_start else v_end + 1440 - v_start end;
  if (p_rules ->> 'break_minutes')::int >= v_shift then
    raise exception 'Break (% min) must be shorter than the shift (% min).', p_rules ->> 'break_minutes', v_shift;
  end if;
  if (p_rules ->> 'absent_below_minutes')::int > 0
     and (p_rules ->> 'half_day_below_minutes')::int > 0
     and (p_rules ->> 'absent_below_minutes')::int > (p_rules ->> 'half_day_below_minutes')::int then
    raise exception '"Absent if worked less than" cannot be more than "Half day if worked less than".';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------
-- One row only (singleton). uuid id because the audit trigger logs row ids
-- as uuid.
create table public.hr_settings (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  salary_journal_enabled boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.hr_settings (singleton) values (true) on conflict (singleton) do nothing;

create table public.hr_policy_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_policy_groups_name_chk check (length(btrim(name)) between 1 and 100)
);
create unique index hr_policy_groups_name_uq on public.hr_policy_groups (lower(btrim(name)));

create table public.hr_policy_versions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.hr_policy_groups(id) on delete restrict,
  effective_from date not null,
  rules jsonb not null,
  reason text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (group_id, effective_from)
);

create sequence public.hr_employee_code_seq;

create table public.hr_employees (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  full_name text not null,
  father_name text,
  cnic text,
  phone text,
  address text,
  designation text,
  department text,
  join_date date not null,
  leave_date date,
  status text not null default 'Active',
  notes text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_employees_status_chk check (status in ('Active', 'Left')),
  constraint hr_employees_name_chk check (length(btrim(full_name)) between 1 and 120),
  constraint hr_employees_leave_chk check (
    (status = 'Active' and leave_date is null) or (status = 'Left' and leave_date is not null and leave_date >= join_date)
  )
);
create index hr_employees_status_idx on public.hr_employees (status, full_name);

create table public.hr_employee_terms (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete restrict,
  effective_from date not null,
  policy_group_id uuid not null references public.hr_policy_groups(id) on delete restrict,
  employee_type text not null,
  monthly_salary numeric(14,2),
  wage_basis text,
  wage_rate numeric(14,4),
  rule_overrides jsonb not null default '{}'::jsonb,
  reason text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (employee_id, effective_from),
  constraint hr_terms_type_chk check (employee_type in ('permanent', 'daily_wager')),
  constraint hr_terms_pay_chk check (
    (employee_type = 'permanent' and monthly_salary is not null and monthly_salary >= 0
       and wage_basis is null and wage_rate is null)
    or (employee_type = 'daily_wager' and monthly_salary is null
       and wage_basis in ('per_day', 'per_minute') and wage_rate is not null and wage_rate > 0)
  )
);
create index hr_employee_terms_group_idx on public.hr_employee_terms (policy_group_id);

create trigger trg_updated_at before update on public.hr_policy_groups for each row execute function public.fn_set_updated_at();
create trigger trg_updated_at before update on public.hr_employees for each row execute function public.fn_set_updated_at();

create trigger trg_audit after insert or update or delete on public.hr_settings for each row execute function public.fn_audit_row();
create trigger trg_audit after insert or update or delete on public.hr_policy_groups for each row execute function public.fn_audit_row();
create trigger trg_audit after insert or update or delete on public.hr_policy_versions for each row execute function public.fn_audit_row();
create trigger trg_audit after insert or update or delete on public.hr_employees for each row execute function public.fn_audit_row();
create trigger trg_audit after insert or update or delete on public.hr_employee_terms for each row execute function public.fn_audit_row();

-- Read-only to the API: select for HR / Owner / Accounts / Auditor, every
-- write through the functions below.
alter table public.hr_settings enable row level security;
alter table public.hr_policy_groups enable row level security;
alter table public.hr_policy_versions enable row level security;
alter table public.hr_employees enable row level security;
alter table public.hr_employee_terms enable row level security;

create policy p_select on public.hr_settings for select to authenticated using (public.fn_hr_can_read());
create policy p_select on public.hr_policy_groups for select to authenticated using (public.fn_hr_can_read());
create policy p_select on public.hr_policy_versions for select to authenticated using (public.fn_hr_can_read());
create policy p_select on public.hr_employees for select to authenticated using (public.fn_hr_can_read());
create policy p_select on public.hr_employee_terms for select to authenticated using (public.fn_hr_can_read());

revoke all on public.hr_settings, public.hr_policy_groups, public.hr_policy_versions,
  public.hr_employees, public.hr_employee_terms from anon, authenticated;
grant select on public.hr_settings, public.hr_policy_groups, public.hr_policy_versions,
  public.hr_employees, public.hr_employee_terms to authenticated;
revoke all on sequence public.hr_employee_code_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Lookups used by every later part
-- ---------------------------------------------------------------------------
-- The terms row in force for an employee on a day (null before joining).
create or replace function public.fn_hr_terms_on(p_employee_id uuid, p_date date)
returns public.hr_employee_terms
language sql
stable
security definer
set search_path = public
as $$
  select t.* from public.hr_employee_terms t
  where t.employee_id = p_employee_id and t.effective_from <= p_date
  order by t.effective_from desc
  limit 1;
$$;

-- The rules in force for a group on a day (null before its first version).
create or replace function public.fn_hr_group_rules_on(p_group_id uuid, p_date date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select v.rules from public.hr_policy_versions v
  where v.group_id = p_group_id and v.effective_from <= p_date
  order by v.effective_from desc
  limit 1;
$$;

-- Final rules for one employee on one day:
-- defaults <- group version <- the employee's own overrides.
-- Null when the employee had no terms yet on that day.
create or replace function public.fn_hr_rules_for(p_employee_id uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_terms public.hr_employee_terms;
  v_group jsonb;
begin
  if not public.fn_hr_can_read() then
    raise exception 'Not allowed.';
  end if;
  v_terms := public.fn_hr_terms_on(p_employee_id, p_date);
  if v_terms.id is null then
    return null;
  end if;
  v_group := public.fn_hr_group_rules_on(v_terms.policy_group_id, p_date);
  return public.fn_hr_default_rules() || coalesce(v_group, '{}'::jsonb) || v_terms.rule_overrides;
end;
$$;

-- List view: each employee with the terms and group in force today
-- (Pakistan time) and the date of any change already scheduled after
-- today. security_invoker so the tables' own RLS applies.
create or replace view public.hr_employees_current
with (security_invoker = true)
as
select
  e.*,
  t.id as terms_id,
  t.effective_from as terms_from,
  t.employee_type,
  t.monthly_salary,
  t.wage_basis,
  t.wage_rate,
  t.policy_group_id,
  g.name as policy_group_name,
  (t.rule_overrides <> '{}'::jsonb) as has_overrides,
  (select min(f.effective_from) from public.hr_employee_terms f
    where f.employee_id = e.id and f.effective_from > (now() at time zone 'Asia/Karachi')::date) as next_change_from
from public.hr_employees e
left join lateral (
  select * from public.hr_employee_terms x
  where x.employee_id = e.id and x.effective_from <= greatest((now() at time zone 'Asia/Karachi')::date, e.join_date)
  order by x.effective_from desc
  limit 1
) t on true
left join public.hr_policy_groups g on g.id = t.policy_group_id;

revoke all on public.hr_employees_current from anon, authenticated;
grant select on public.hr_employees_current to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Policy groups
-- ---------------------------------------------------------------------------
create or replace function public.fn_hr_create_policy_group(
  p_name text,
  p_description text,
  p_rules jsonb,
  p_effective_from date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.fn_hr_can_manage() then
    raise exception 'Only the Owner or HR can manage attendance policies.';
  end if;
  if p_effective_from is null then
    raise exception 'Effective from date is required.';
  end if;
  if exists (select 1 from public.hr_policy_groups where lower(btrim(name)) = lower(btrim(coalesce(p_name, '')))) then
    raise exception 'A policy group named "%" already exists.', btrim(p_name);
  end if;

  insert into public.hr_policy_groups (name, description)
  values (btrim(coalesce(p_name, '')), nullif(btrim(coalesce(p_description, '')), ''))
  returning id into v_id;

  insert into public.hr_policy_versions (group_id, effective_from, rules, reason)
  values (v_id, p_effective_from, public.fn_hr_validate_rules(coalesce(p_rules, '{}'::jsonb), true), 'Created');

  return v_id;
end;
$$;

create or replace function public.fn_hr_update_policy_group(
  p_group_id uuid,
  p_name text,
  p_description text,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.fn_hr_can_manage() then
    raise exception 'Only the Owner or HR can manage attendance policies.';
  end if;
  if not exists (select 1 from public.hr_policy_groups where id = p_group_id for update) then
    raise exception 'Policy group not found.';
  end if;
  if exists (
    select 1 from public.hr_policy_groups
    where id <> p_group_id and lower(btrim(name)) = lower(btrim(coalesce(p_name, '')))
  ) then
    raise exception 'A policy group named "%" already exists.', btrim(p_name);
  end if;
  -- Switching a group off only hides it from new assignments; it is
  -- refused while an active employee is on it today or later.
  if p_is_active = false and exists (
    select 1 from public.hr_employees e
    where e.status = 'Active'
      and (public.fn_hr_terms_on(e.id, greatest((now() at time zone 'Asia/Karachi')::date, e.join_date))).policy_group_id = p_group_id
  ) then
    raise exception 'Active employees are still on this group. Move them to another group first.';
  end if;
  if p_is_active = false and exists (
    select 1 from public.hr_employee_terms t
    where t.policy_group_id = p_group_id and t.effective_from > (now() at time zone 'Asia/Karachi')::date
  ) then
    raise exception 'A future terms change still uses this group.';
  end if;

  update public.hr_policy_groups
  set name = btrim(coalesce(p_name, '')),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      is_active = coalesce(p_is_active, is_active)
  where id = p_group_id;
end;
$$;

-- Saves a policy change from p_effective_from onwards. A version already
-- on that exact date is replaced (fixing a mistake the same day); any
-- other date adds a new version and leaves earlier ones untouched.
create or replace function public.fn_hr_set_policy_version(
  p_group_id uuid,
  p_effective_from date,
  p_rules jsonb,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_rules jsonb;
begin
  if not public.fn_hr_can_manage() then
    raise exception 'Only the Owner or HR can manage attendance policies.';
  end if;
  if p_effective_from is null then
    raise exception 'Effective from date is required.';
  end if;
  perform 1 from public.hr_policy_groups where id = p_group_id for update;
  if not found then
    raise exception 'Policy group not found.';
  end if;

  v_rules := public.fn_hr_validate_rules(coalesce(p_rules, '{}'::jsonb), true);

  -- Every employee whose own overrides apply on top of this group must
  -- still end up with a consistent rule set.
  perform public.fn_hr_check_rule_set(v_rules || t.rule_overrides)
  from public.hr_employee_terms t
  where t.policy_group_id = p_group_id and t.rule_overrides <> '{}'::jsonb;

  insert into public.hr_policy_versions (group_id, effective_from, rules, reason)
  values (p_group_id, p_effective_from, v_rules, nullif(btrim(coalesce(p_reason, '')), ''))
  on conflict (group_id, effective_from)
  do update set rules = excluded.rules, reason = excluded.reason,
                created_by = auth.uid(), created_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- Removes a version saved by mistake. The group's first version cannot be
-- removed, so every day from its start always has rules.
create or replace function public.fn_hr_delete_policy_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.hr_policy_versions;
begin
  if not public.fn_hr_can_manage() then
    raise exception 'Only the Owner or HR can manage attendance policies.';
  end if;
  select * into v from public.hr_policy_versions where id = p_version_id;
  if v.id is null then
    raise exception 'Policy version not found.';
  end if;
  perform 1 from public.hr_policy_groups where id = v.group_id for update;
  if not exists (
    select 1 from public.hr_policy_versions
    where group_id = v.group_id and effective_from < v.effective_from
  ) then
    raise exception 'The first version of a policy cannot be removed. Change it with a new version instead.';
  end if;
  delete from public.hr_policy_versions where id = p_version_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Employees and their terms
-- ---------------------------------------------------------------------------
create or replace function public._fn_hr_clean_terms(
  p_policy_group_id uuid,
  p_employee_type text,
  p_monthly_salary numeric,
  p_wage_basis text,
  p_wage_rate numeric,
  p_rule_overrides jsonb,
  p_effective_from date,
  out o_monthly_salary numeric,
  out o_wage_basis text,
  out o_wage_rate numeric,
  out o_overrides jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_group_rules jsonb;
begin
  if p_policy_group_id is null or not exists (
    select 1 from public.hr_policy_groups where id = p_policy_group_id and is_active
  ) then
    raise exception 'Pick an active policy group.';
  end if;
  v_group_rules := public.fn_hr_group_rules_on(p_policy_group_id, p_effective_from);
  if v_group_rules is null then
    raise exception 'This policy group has no rules on % yet. Its first version starts later.', to_char(p_effective_from, 'DD-Mon-YYYY');
  end if;

  if p_employee_type = 'permanent' then
    if p_monthly_salary is null or p_monthly_salary < 0 then
      raise exception 'Monthly salary is required for a permanent employee.';
    end if;
    o_monthly_salary := round(p_monthly_salary, 2);
  elsif p_employee_type = 'daily_wager' then
    if p_wage_basis not in ('per_day', 'per_minute') or p_wage_basis is null then
      raise exception 'Choose whether the daily wager is paid per day or per minute.';
    end if;
    if p_wage_rate is null or p_wage_rate <= 0 then
      raise exception 'Wage rate must be more than 0.';
    end if;
    o_wage_basis := p_wage_basis;
    o_wage_rate := round(p_wage_rate, 4);
  else
    raise exception 'Employee type must be permanent or daily_wager.';
  end if;

  o_overrides := public.fn_hr_validate_rules(coalesce(p_rule_overrides, '{}'::jsonb), false);
  perform public.fn_hr_check_rule_set(public.fn_hr_default_rules() || v_group_rules || o_overrides);
end;
$$;

create or replace function public.fn_hr_create_employee(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_code text := nullif(btrim(coalesce(p ->> 'code', '')), '');
  v_join date := (p ->> 'join_date')::date;
  v_from date := coalesce((p ->> 'effective_from')::date, (p ->> 'join_date')::date);
  v_terms record;
begin
  if not public.fn_hr_can_manage() then
    raise exception 'Only the Owner or HR can manage employees.';
  end if;
  if v_join is null then
    raise exception 'Joining date is required.';
  end if;
  if v_from <> v_join then
    -- The first terms always start on the joining date, so every worked
    -- day has terms.
    raise exception 'The first terms must start on the joining date.';
  end if;
  if v_code is null then
    loop
      v_code := 'EMP-' || lpad(nextval('public.hr_employee_code_seq')::text, 4, '0');
      exit when not exists (select 1 from public.hr_employees where code = v_code);
    end loop;
  elsif exists (select 1 from public.hr_employees where lower(code) = lower(v_code)) then
    raise exception 'Employee code % is already used.', v_code;
  end if;

  select * into v_terms from public._fn_hr_clean_terms(
    (p ->> 'policy_group_id')::uuid, p ->> 'employee_type', (p ->> 'monthly_salary')::numeric,
    p ->> 'wage_basis', (p ->> 'wage_rate')::numeric, p -> 'rule_overrides', v_join);

  insert into public.hr_employees (code, full_name, father_name, cnic, phone, address, designation, department, join_date, notes)
  values (
    v_code,
    btrim(coalesce(p ->> 'full_name', '')),
    nullif(btrim(coalesce(p ->> 'father_name', '')), ''),
    nullif(btrim(coalesce(p ->> 'cnic', '')), ''),
    nullif(btrim(coalesce(p ->> 'phone', '')), ''),
    nullif(btrim(coalesce(p ->> 'address', '')), ''),
    nullif(btrim(coalesce(p ->> 'designation', '')), ''),
    nullif(btrim(coalesce(p ->> 'department', '')), ''),
    v_join,
    nullif(btrim(coalesce(p ->> 'notes', '')), '')
  )
  returning id into v_id;

  insert into public.hr_employee_terms (employee_id, effective_from, policy_group_id, employee_type,
    monthly_salary, wage_basis, wage_rate, rule_overrides, reason)
  values (v_id, v_join, (p ->> 'policy_group_id')::uuid, p ->> 'employee_type',
    v_terms.o_monthly_salary, v_terms.o_wage_basis, v_terms.o_wage_rate, v_terms.o_overrides, 'Joined');

  return v_id;
end;
$$;

-- Personal details only. Pay, group and rule changes go through
-- fn_hr_set_employee_terms so they carry an effective-from date.
create or replace function public.fn_hr_update_employee(p_employee_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp public.hr_employees;
  v_code text := nullif(btrim(coalesce(p ->> 'code', '')), '');
  v_join date := coalesce((p ->> 'join_date')::date, null);
  v_first date;
begin
  if not public.fn_hr_can_manage() then
    raise exception 'Only the Owner or HR can manage employees.';
  end if;
  select * into v_emp from public.hr_employees where id = p_employee_id for update;
  if v_emp.id is null then
    raise exception 'Employee not found.';
  end if;
  if v_code is null then
    v_code := v_emp.code;
  elsif exists (select 1 from public.hr_employees where id <> p_employee_id and lower(code) = lower(v_code)) then
    raise exception 'Employee code % is already used.', v_code;
  end if;

  v_join := coalesce(v_join, v_emp.join_date);
  if v_join <> v_emp.join_date then
    -- Moving the joining date moves the first terms with it, as long as
    -- that does not jump past a later terms change.
    select min(effective_from) into v_first from public.hr_employee_terms
    where employee_id = p_employee_id and effective_from > v_emp.join_date;
    if v_first is not null and v_join >= v_first then
      raise exception 'Joining date must be before the next terms change (%).', to_char(v_first, 'DD-Mon-YYYY');
    end if;
    if v_emp.leave_date is not null and v_join > v_emp.leave_date then
      raise exception 'Joining date cannot be after the leaving date.';
    end if;
    if public.fn_hr_group_rules_on(
         (select policy_group_id from public.hr_employee_terms where employee_id = p_employee_id and effective_from = v_emp.join_date),
         v_join) is null then
      raise exception 'The policy group has no rules on % yet.', to_char(v_join, 'DD-Mon-YYYY');
    end if;
    update public.hr_employee_terms set effective_from = v_join
    where employee_id = p_employee_id and effective_from = v_emp.join_date;
  end if;

  update public.hr_employees
  set code = v_code,
      full_name = btrim(coalesce(p ->> 'full_name', v_emp.full_name)),
      father_name = nullif(btrim(coalesce(p ->> 'father_name', '')), ''),
      cnic = nullif(btrim(coalesce(p ->> 'cnic', '')), ''),
      phone = nullif(btrim(coalesce(p ->> 'phone', '')), ''),
      address = nullif(btrim(coalesce(p ->> 'address', '')), ''),
      designation = nullif(btrim(coalesce(p ->> 'designation', '')), ''),
      department = nullif(btrim(coalesce(p ->> 'department', '')), ''),
      join_date = v_join,
      notes = nullif(btrim(coalesce(p ->> 'notes', '')), '')
  where id = p_employee_id;
end;
$$;

-- Saves new terms from p_effective_from onwards (same date = replace).
create or replace function public.fn_hr_set_employee_terms(
  p_employee_id uuid,
  p_effective_from date,
  p_policy_group_id uuid,
  p_employee_type text,
  p_monthly_salary numeric,
  p_wage_basis text,
  p_wage_rate numeric,
  p_rule_overrides jsonb,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp public.hr_employees;
  v_terms record;
  v_id uuid;
begin
  if not public.fn_hr_can_manage() then
    raise exception 'Only the Owner or HR can manage employees.';
  end if;
  select * into v_emp from public.hr_employees where id = p_employee_id for update;
  if v_emp.id is null then
    raise exception 'Employee not found.';
  end if;
  if p_effective_from is null then
    raise exception 'Effective from date is required.';
  end if;
  if p_effective_from < v_emp.join_date then
    raise exception 'Terms cannot start before the joining date (%).', to_char(v_emp.join_date, 'DD-Mon-YYYY');
  end if;
  if v_emp.leave_date is not null and p_effective_from > v_emp.leave_date then
    raise exception 'Terms cannot start after the leaving date (%).', to_char(v_emp.leave_date, 'DD-Mon-YYYY');
  end if;

  select * into v_terms from public._fn_hr_clean_terms(
    p_policy_group_id, p_employee_type, p_monthly_salary, p_wage_basis, p_wage_rate, p_rule_overrides, p_effective_from);

  insert into public.hr_employee_terms (employee_id, effective_from, policy_group_id, employee_type,
    monthly_salary, wage_basis, wage_rate, rule_overrides, reason)
  values (p_employee_id, p_effective_from, p_policy_group_id, p_employee_type,
    v_terms.o_monthly_salary, v_terms.o_wage_basis, v_terms.o_wage_rate, v_terms.o_overrides,
    nullif(btrim(coalesce(p_reason, '')), ''))
  on conflict (employee_id, effective_from)
  do update set policy_group_id = excluded.policy_group_id, employee_type = excluded.employee_type,
                monthly_salary = excluded.monthly_salary, wage_basis = excluded.wage_basis,
                wage_rate = excluded.wage_rate, rule_overrides = excluded.rule_overrides,
                reason = coalesce(excluded.reason, public.hr_employee_terms.reason),
                created_by = auth.uid(), created_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- Removes a terms change saved by mistake; the joining-date terms stay.
create or replace function public.fn_hr_delete_employee_terms(p_terms_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.hr_employee_terms;
  v_join date;
begin
  if not public.fn_hr_can_manage() then
    raise exception 'Only the Owner or HR can manage employees.';
  end if;
  select * into v from public.hr_employee_terms where id = p_terms_id;
  if v.id is null then
    raise exception 'Terms not found.';
  end if;
  select join_date into v_join from public.hr_employees where id = v.employee_id for update;
  if v.effective_from <= v_join then
    raise exception 'The joining-date terms cannot be removed. Add a new change instead.';
  end if;
  delete from public.hr_employee_terms where id = p_terms_id;
end;
$$;

create or replace function public.fn_hr_set_employee_status(p_employee_id uuid, p_status text, p_leave_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp public.hr_employees;
begin
  if not public.fn_hr_can_manage() then
    raise exception 'Only the Owner or HR can manage employees.';
  end if;
  select * into v_emp from public.hr_employees where id = p_employee_id for update;
  if v_emp.id is null then
    raise exception 'Employee not found.';
  end if;
  if p_status = 'Left' then
    if p_leave_date is null then
      raise exception 'Leaving date is required.';
    end if;
    if p_leave_date < v_emp.join_date then
      raise exception 'Leaving date cannot be before the joining date.';
    end if;
    if exists (select 1 from public.hr_employee_terms where employee_id = p_employee_id and effective_from > p_leave_date) then
      raise exception 'A terms change is scheduled after this leaving date. Remove it first.';
    end if;
    update public.hr_employees set status = 'Left', leave_date = p_leave_date where id = p_employee_id;
  elsif p_status = 'Active' then
    if not (public.fn_hr_terms_on(p_employee_id, greatest((now() at time zone 'Asia/Karachi')::date, v_emp.join_date))).policy_group_id
         in (select id from public.hr_policy_groups where is_active) then
      raise exception 'This employee''s policy group is switched off. Turn it on, or change the terms first.';
    end if;
    update public.hr_employees set status = 'Active', leave_date = null where id = p_employee_id;
  else
    raise exception 'Status must be Active or Left.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Settings (Owner only)
-- ---------------------------------------------------------------------------
create or replace function public.fn_hr_update_settings(p_salary_journal_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the Owner can change HR settings.';
  end if;
  if p_salary_journal_enabled is null then
    raise exception 'Choose on or off.';
  end if;
  update public.hr_settings
  set salary_journal_enabled = p_salary_journal_enabled, updated_by = auth.uid(), updated_at = now()
  where singleton;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public.fn_hr_can_manage() from public, anon;
revoke execute on function public.fn_hr_can_read() from public, anon;
revoke execute on function public.fn_hr_default_rules() from public, anon;
revoke execute on function public.fn_hr_validate_rules(jsonb, boolean) from public, anon;
revoke execute on function public.fn_hr_check_rule_set(jsonb) from public, anon;
revoke execute on function public.fn_hr_terms_on(uuid, date) from public, anon, authenticated;
revoke execute on function public.fn_hr_group_rules_on(uuid, date) from public, anon, authenticated;
revoke execute on function public.fn_hr_rules_for(uuid, date) from public, anon;
revoke execute on function public.fn_hr_create_policy_group(text, text, jsonb, date) from public, anon;
revoke execute on function public.fn_hr_update_policy_group(uuid, text, text, boolean) from public, anon;
revoke execute on function public.fn_hr_set_policy_version(uuid, date, jsonb, text) from public, anon;
revoke execute on function public.fn_hr_delete_policy_version(uuid) from public, anon;
revoke execute on function public._fn_hr_clean_terms(uuid, text, numeric, text, numeric, jsonb, date) from public, anon, authenticated;
revoke execute on function public.fn_hr_create_employee(jsonb) from public, anon;
revoke execute on function public.fn_hr_update_employee(uuid, jsonb) from public, anon;
revoke execute on function public.fn_hr_set_employee_terms(uuid, date, uuid, text, numeric, text, numeric, jsonb, text) from public, anon;
revoke execute on function public.fn_hr_delete_employee_terms(uuid) from public, anon;
revoke execute on function public.fn_hr_set_employee_status(uuid, text, date) from public, anon;
revoke execute on function public.fn_hr_update_settings(boolean) from public, anon;

grant execute on function public.fn_hr_can_manage() to authenticated;
grant execute on function public.fn_hr_can_read() to authenticated;
grant execute on function public.fn_hr_default_rules() to authenticated;
grant execute on function public.fn_hr_validate_rules(jsonb, boolean) to authenticated;
grant execute on function public.fn_hr_check_rule_set(jsonb) to authenticated;
grant execute on function public.fn_hr_rules_for(uuid, date) to authenticated;
grant execute on function public.fn_hr_create_policy_group(text, text, jsonb, date) to authenticated;
grant execute on function public.fn_hr_update_policy_group(uuid, text, text, boolean) to authenticated;
grant execute on function public.fn_hr_set_policy_version(uuid, date, jsonb, text) to authenticated;
grant execute on function public.fn_hr_delete_policy_version(uuid) to authenticated;
grant execute on function public.fn_hr_create_employee(jsonb) to authenticated;
grant execute on function public.fn_hr_update_employee(uuid, jsonb) to authenticated;
grant execute on function public.fn_hr_set_employee_terms(uuid, date, uuid, text, numeric, text, numeric, jsonb, text) to authenticated;
grant execute on function public.fn_hr_delete_employee_terms(uuid) to authenticated;
grant execute on function public.fn_hr_set_employee_status(uuid, text, date) to authenticated;
grant execute on function public.fn_hr_update_settings(boolean) to authenticated;
