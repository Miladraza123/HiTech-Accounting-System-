-- Phase 47.02: HR / Attendance, part (b): holidays, leave types, the daily
-- attendance register and the per-day calculation.
--
--  * hr_attendance holds exactly what the clerk typed for one employee on
--    one day: present (In/Out, optional extra In/Out pairs), absent, or
--    leave (full or half day, with a leave type). The clerk's entry is
--    final; nothing is approved.
--  * Nothing calculated is stored. fn_hr_calc_day() turns one entry plus
--    the rules in force that day into minutes worked, late / early
--    minutes, half day / absent, and overtime. The daily grid, the
--    reports and the salary sheet (47.03) all call it, so a policy change
--    with an effective date is picked up everywhere the same way.
--  * src/lib/hrDayCalc.ts is the browser copy used for the live preview;
--    src/lib/hrDayCalc.fixtures.json is checked against both.

-- ---------------------------------------------------------------------------
-- 1. Holidays and leave types
-- ---------------------------------------------------------------------------
create table public.hr_holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name text not null,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  constraint hr_holidays_name_chk check (length(btrim(name)) between 1 and 100)
);

create table public.hr_leave_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_paid boolean not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_leave_types_name_chk check (length(btrim(name)) between 1 and 60)
);
create unique index hr_leave_types_name_uq on public.hr_leave_types (lower(btrim(name)));

insert into public.hr_leave_types (name, is_paid, created_by) values
  ('Casual', true, null), ('Sick', true, null), ('Annual', true, null), ('Unpaid', false, null)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Attendance entries
-- ---------------------------------------------------------------------------
create table public.hr_attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete restrict,
  work_date date not null,
  mark text not null,
  check_in time,
  check_out time,
  extra_pairs jsonb not null default '[]'::jsonb,
  leave_type_id uuid references public.hr_leave_types(id) on delete restrict,
  leave_fraction numeric(3,2),
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (employee_id, work_date),
  constraint hr_attendance_mark_chk check (mark in ('present', 'absent', 'leave')),
  constraint hr_attendance_leave_chk check (
    (mark = 'leave' and leave_type_id is not null and leave_fraction in (0.5, 1))
    or (mark <> 'leave' and leave_type_id is null and leave_fraction is null)
  ),
  constraint hr_attendance_times_chk check (
    mark = 'present' or (mark = 'leave' and leave_fraction = 0.5)
    or (check_in is null and check_out is null and extra_pairs = '[]'::jsonb)
  ),
  constraint hr_attendance_pairs_chk check (jsonb_typeof(extra_pairs) = 'array' and jsonb_array_length(extra_pairs) <= 4)
);
create index hr_attendance_date_idx on public.hr_attendance (work_date);

create trigger trg_updated_at before update on public.hr_leave_types for each row execute function public.fn_set_updated_at();
create trigger trg_updated_at before update on public.hr_attendance for each row execute function public.fn_set_updated_at();
create trigger trg_audit after insert or update or delete on public.hr_holidays for each row execute function public.fn_audit_row();
create trigger trg_audit after insert or update or delete on public.hr_leave_types for each row execute function public.fn_audit_row();
create trigger trg_audit after insert or update or delete on public.hr_attendance for each row execute function public.fn_audit_row();

alter table public.hr_holidays enable row level security;
alter table public.hr_leave_types enable row level security;
alter table public.hr_attendance enable row level security;
create policy p_select on public.hr_holidays for select to authenticated using (public.fn_hr_can_read());
create policy p_select on public.hr_leave_types for select to authenticated using (public.fn_hr_can_read());
create policy p_select on public.hr_attendance for select to authenticated using (public.fn_hr_can_read());
revoke all on public.hr_holidays, public.hr_leave_types, public.hr_attendance from anon, authenticated;
grant select on public.hr_holidays, public.hr_leave_types, public.hr_attendance to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Lock hook
-- ---------------------------------------------------------------------------
-- True when a finalised salary sheet already covers this employee's day
-- (p_employee_id null = any employee on that date). Phase 47.03 replaces
-- this body once salary sheets exist; until then nothing is locked.
create or replace function public._fn_hr_day_locked(p_employee_id uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select false;
$$;

-- Employees whose day p_date is locked (for the grid to grey them out).
create or replace function public.fn_hr_locked_employees(p_date date)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(e.id), '{}')
  from public.hr_employees e
  where public.fn_hr_can_read() and public._fn_hr_day_locked(e.id, p_date);
$$;

-- ---------------------------------------------------------------------------
-- 4. Rules lookup without the caller check (internal)
-- ---------------------------------------------------------------------------
create or replace function public._fn_hr_rules_on(p_employee_id uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_terms public.hr_employee_terms;
begin
  v_terms := public.fn_hr_terms_on(p_employee_id, p_date);
  if v_terms.id is null then
    return null;
  end if;
  return public.fn_hr_default_rules()
    || coalesce(public.fn_hr_group_rules_on(v_terms.policy_group_id, p_date), '{}'::jsonb)
    || v_terms.rule_overrides;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The per-day calculation (pure)
-- ---------------------------------------------------------------------------
-- p_day_kind  'work' | 'off' (weekly off) | 'holiday'
-- p_mark      'present' | 'absent' | 'leave' | null (nothing entered)
-- p_pairs     [{"in":"HH:MM"|null,"out":"HH:MM"|null}, …]; the first pair
--             is the main In/Out, the rest are the optional extra pairs
-- p_leave_fraction  1 or 0.5 when p_mark = 'leave'
--
-- Returns:
--  status         P present · HD half day · A absent · L leave · HL half
--                 leave · NE nothing entered · W worked on an off day /
--                 holiday · OFF weekly off · HOL holiday
--  work_value     day fraction earned by working (1, 0.5 or 0)
--  leave_value    day fraction on leave (1, 0.5 or 0)
--  worked / net   minutes between In and Out / after the unpaid break
--  normal         paid minutes up to a full shift
--  late, early    minutes (working days only)
--  late_counted   counted as a late for the "every N lates" rule
--  late_cut, early_cut  minutes to cut under the deduct_minutes policies
--  ot             minutes past a full shift (once past ot_min_minutes)
--  offday_ot      all minutes worked on an off day / holiday (same min)
--  warnings       text codes for the grid
--
-- Times: a time more than 4 hours before the shift start belongs to the
-- next day (night shifts and late check-outs). An Out at or before its In
-- is on the next day too.
-- Break: an unpaid break is cut only when a single In/Out pair covers the
-- middle of the shift; with extra pairs the gaps between them are the
-- break.
-- Missing Out on the main pair = shift end; missing In = shift start
-- (both flagged). An extra pair missing either time is ignored (flagged).
-- "Present" with no times at all = a normal full day (flagged).
create or replace function public.fn_hr_calc_day(
  p_rules jsonb,
  p_day_kind text,
  p_mark text,
  p_pairs jsonb,
  p_leave_fraction numeric
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_start int := split_part(p_rules ->> 'shift_start', ':', 1)::int * 60 + split_part(p_rules ->> 'shift_start', ':', 2)::int;
  v_end int := split_part(p_rules ->> 'shift_end', ':', 1)::int * 60 + split_part(p_rules ->> 'shift_end', ':', 2)::int;
  v_shift int;
  v_break int := (p_rules ->> 'break_minutes')::int;
  v_break_paid boolean := (p_rules ->> 'break_paid')::boolean;
  v_paid_shift int;
  v_anchor int;
  v_work boolean := p_day_kind = 'work';
  v_off_status text := case p_day_kind when 'holiday' then 'HOL' else 'OFF' end;
  v_warn text[] := '{}';
  v_pair jsonb;
  v_idx int := 0;
  v_in int;
  v_out int;
  v_t text;
  v_segs int := 0;
  v_worked int := 0;
  v_first_in int;
  v_last_out int;
  v_single_in int;
  v_single_out int;
  v_mid int;
  v_break_cut int := 0;
  v_net int;
  v_late int := 0;
  v_early int := 0;
  v_work_value numeric := 1;
  v_leave_value numeric := 0;
  v_status text;
  v_late_counted boolean := false;
  v_late_cut int := 0;
  v_early_cut int := 0;
  v_normal int := 0;
  v_ot int := 0;
  v_offday_ot int := 0;
  v_ot_min int := (p_rules ->> 'ot_min_minutes')::int;
  v_ot_on boolean := (p_rules ->> 'ot_enabled')::boolean;
  v_half_leave boolean := p_mark = 'leave' and p_leave_fraction = 0.5;
begin
  if v_end <= v_start then
    v_end := v_end + 1440;
  end if;
  v_shift := v_end - v_start;
  v_paid_shift := v_shift - case when v_break_paid then 0 else v_break end;
  v_anchor := v_start - 240;
  v_mid := v_start + v_shift / 2;

  if p_mark = 'leave' then
    if not v_work then
      v_warn := array_append(v_warn, 'leave_on_off_day');
    else
      v_leave_value := trim_scale(p_leave_fraction);
    end if;
  end if;

  if p_mark is null or p_mark = 'absent' or (p_mark = 'leave' and not v_half_leave) then
    v_status := case
      when not v_work then v_off_status
      when p_mark is null then 'NE'
      when p_mark = 'absent' then 'A'
      else 'L'
    end;
    if p_mark is null and v_work then
      v_warn := array_append(v_warn, 'not_entered');
    end if;
    return jsonb_build_object(
      'status', v_status, 'work_value', 0, 'leave_value', v_leave_value,
      'worked', 0, 'net', 0, 'normal', 0, 'late', 0, 'early', 0, 'late_counted', false,
      'late_cut', 0, 'early_cut', 0, 'ot', 0, 'offday_ot', 0, 'break_cut', 0, 'warnings', to_jsonb(v_warn));
  end if;

  -- Present, or half-day leave with (or without) times for the other half.
  for v_pair in select value from jsonb_array_elements(coalesce(p_pairs, '[]'::jsonb)) loop
    v_idx := v_idx + 1;
    v_t := nullif(v_pair ->> 'in', '');
    v_in := case when v_t is null then null else split_part(v_t, ':', 1)::int * 60 + split_part(v_t, ':', 2)::int end;
    v_t := nullif(v_pair ->> 'out', '');
    v_out := case when v_t is null then null else split_part(v_t, ':', 1)::int * 60 + split_part(v_t, ':', 2)::int end;

    if v_in is null and v_out is null then
      continue;
    end if;
    if v_idx > 1 and (v_in is null or v_out is null) then
      v_warn := array_append(v_warn, 'incomplete_pair');
      continue;
    end if;

    if v_in is null then
      v_warn := array_append(v_warn, 'missing_in');
      v_in := v_start;
    elsif v_in < v_anchor then
      v_in := v_in + 1440;
    end if;
    if v_out is null then
      v_warn := array_append(v_warn, 'missing_out');
      v_out := v_end;
    elsif v_out < v_anchor then
      v_out := v_out + 1440;
    end if;
    if v_out <= v_in then
      v_out := v_out + 1440;
    end if;

    v_segs := v_segs + 1;
    v_worked := v_worked + (v_out - v_in);
    v_first_in := least(coalesce(v_first_in, v_in), v_in);
    v_last_out := greatest(coalesce(v_last_out, v_out), v_out);
    v_single_in := v_in;
    v_single_out := v_out;
  end loop;

  if v_segs = 0 then
    if v_half_leave then
      -- Half-day leave and nothing else worked: the other half is absent.
      return jsonb_build_object(
        'status', case when v_work then 'HL' else v_off_status end, 'work_value', 0, 'leave_value', v_leave_value,
        'worked', 0, 'net', 0, 'normal', 0, 'late', 0, 'early', 0, 'late_counted', false,
        'late_cut', 0, 'early_cut', 0, 'ot', 0, 'offday_ot', 0, 'break_cut', 0, 'warnings', to_jsonb(v_warn));
    end if;
    -- "Present" with no times: a normal full day.
    v_warn := array_append(v_warn, 'no_times');
    v_segs := 1;
    v_worked := v_shift;
    v_first_in := v_start;
    v_last_out := v_end;
    v_single_in := v_start;
    v_single_out := v_end;
  end if;

  if not v_break_paid and v_segs = 1 and v_single_in <= v_mid and v_single_out >= v_mid then
    v_break_cut := least(v_break, v_worked);
  end if;
  v_net := v_worked - v_break_cut;

  if v_work then
    v_late := greatest(0, v_first_in - v_start);
    v_early := greatest(0, v_end - v_last_out);
  end if;

  if (p_rules ->> 'absent_below_minutes')::int > 0 and v_net < (p_rules ->> 'absent_below_minutes')::int then
    v_work_value := 0;
  elsif (p_rules ->> 'half_day_below_minutes')::int > 0 and v_net < (p_rules ->> 'half_day_below_minutes')::int then
    v_work_value := 0.5;
  elsif (p_rules ->> 'half_day_late_after_minutes')::int > 0 and v_late > (p_rules ->> 'half_day_late_after_minutes')::int then
    v_work_value := 0.5;
  end if;
  if v_half_leave then
    v_work_value := least(v_work_value, 0.5);
  end if;

  v_status := case
    when not v_work then 'W'
    when v_half_leave then 'HL'
    when v_work_value = 0 then 'A'
    when v_work_value = 0.5 then 'HD'
    else 'P'
  end;

  if v_work and v_work_value = 1 and not v_half_leave then
    if (p_rules ->> 'late_mode') <> 'none' and v_late > (p_rules ->> 'late_grace_minutes')::int then
      v_late_counted := true;
      if (p_rules ->> 'late_mode') = 'deduct_minutes' then
        v_late_cut := v_late;
      end if;
    end if;
    if (p_rules ->> 'early_mode') = 'deduct_minutes' and v_early > (p_rules ->> 'early_grace_minutes')::int then
      v_early_cut := v_early;
    end if;
  end if;

  if v_work_value > 0 then
    v_normal := least(v_net, v_paid_shift);
    if v_ot_on and not v_half_leave and v_net - v_paid_shift > v_ot_min then
      v_ot := v_net - v_paid_shift;
    end if;
  end if;
  if not v_work and v_ot_on and v_net > v_ot_min then
    v_offday_ot := v_net;
  end if;

  if v_late_counted then v_warn := array_append(v_warn, 'late'); end if;
  if v_work and v_early > (p_rules ->> 'early_grace_minutes')::int and v_work_value = 1 then v_warn := array_append(v_warn, 'early'); end if;
  if v_work and v_work_value < 1 and not v_half_leave then v_warn := array_append(v_warn, 'short_day'); end if;
  if v_ot > 0 or v_offday_ot > 0 then v_warn := array_append(v_warn, 'overtime'); end if;
  if v_net > 960 then v_warn := array_append(v_warn, 'long_day'); end if;

  return jsonb_build_object(
    'status', v_status, 'work_value', v_work_value, 'leave_value', v_leave_value,
    'worked', v_worked, 'net', v_net, 'normal', v_normal, 'late', v_late, 'early', v_early,
    'late_counted', v_late_counted, 'late_cut', v_late_cut, 'early_cut', v_early_cut,
    'ot', v_ot, 'offday_ot', v_offday_ot, 'break_cut', v_break_cut, 'warnings', to_jsonb(v_warn));
end;
$$;

-- The pairs array for one stored entry (main pair first, then extras).
create or replace function public._fn_hr_entry_pairs(a public.hr_attendance)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case
    when a.id is null then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object('in', to_char(a.check_in, 'HH24:MI'), 'out', to_char(a.check_out, 'HH24:MI')))
         || coalesce(a.extra_pairs, '[]'::jsonb)
  end;
$$;

-- Weekly off / holiday / working day for an employee's rules.
create or replace function public._fn_hr_day_kind(p_rules jsonb, p_date date)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.hr_holidays h where h.holiday_date = p_date) then 'holiday'
    when (p_rules -> 'working_days') @> to_jsonb(extract(dow from p_date)::int) then 'work'
    else 'off'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Results for a date range (what the grid, reports and salary read)
-- ---------------------------------------------------------------------------
-- One row per employee per day they were employed (joining date to
-- leaving date) in [p_from, p_to]. p_employee_ids null = everybody.
create or replace function public.fn_hr_day_results(p_from date, p_to date, p_employee_ids uuid[] default null)
returns table (
  employee_id uuid,
  work_date date,
  day_kind text,
  employee_type text,
  monthly_salary numeric,
  wage_basis text,
  wage_rate numeric,
  policy_group_id uuid,
  rules jsonb,
  attendance_id uuid,
  mark text,
  check_in text,
  check_out text,
  extra_pairs jsonb,
  leave_type_id uuid,
  leave_paid boolean,
  leave_fraction numeric,
  note text,
  calc jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.fn_hr_can_read() then
    raise exception 'Not allowed.';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose a valid date range.';
  end if;
  if p_to - p_from > 400 then
    raise exception 'Date range is too long (more than 400 days).';
  end if;

  return query
  with days as (
    select e.id as emp_id, d::date as d
    from public.hr_employees e
    cross join generate_series(greatest(p_from, e.join_date), least(p_to, coalesce(e.leave_date, p_to)), interval '1 day') d
    where p_employee_ids is null or e.id = any (p_employee_ids)
  ),
  ruled as (
    select days.emp_id, days.d, t.*, public._fn_hr_rules_on(days.emp_id, days.d) as r
    from days
    cross join lateral public.fn_hr_terms_on(days.emp_id, days.d) t
  )
  select
    x.emp_id,
    x.d,
    k.kind,
    x.employee_type,
    x.monthly_salary,
    x.wage_basis,
    x.wage_rate,
    x.policy_group_id,
    x.r,
    a.id,
    a.mark,
    to_char(a.check_in, 'HH24:MI'),
    to_char(a.check_out, 'HH24:MI'),
    coalesce(a.extra_pairs, '[]'::jsonb),
    a.leave_type_id,
    lt.is_paid,
    a.leave_fraction,
    a.note,
    public.fn_hr_calc_day(x.r, k.kind, a.mark, public._fn_hr_entry_pairs(a), a.leave_fraction)
  from ruled x
  cross join lateral (select public._fn_hr_day_kind(x.r, x.d) as kind) k
  left join public.hr_attendance a on a.employee_id = x.emp_id and a.work_date = x.d
  left join public.hr_leave_types lt on lt.id = a.leave_type_id
  where x.id is not null
  order by x.emp_id, x.d;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Saving a day from the grid
-- ---------------------------------------------------------------------------
-- p_rows: [{employee_id, mark ('present'|'absent'|'leave'|null to clear),
--           check_in, check_out, extra_pairs, leave_type_id,
--           leave_fraction, note}, …]
-- All rows are checked first; nothing is saved unless every row is valid.
-- Returns the number of rows written or cleared.
create or replace function public.fn_hr_save_attendance(p_date date, p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_emp public.hr_employees;
  v_mark text;
  v_in time;
  v_out time;
  v_pairs jsonb;
  v_pair jsonb;
  v_clean_pairs jsonb;
  v_leave_type uuid;
  v_fraction numeric;
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_count int := 0;
  v_seen uuid[] := '{}';
  v_time_re constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  if not public.fn_hr_can_manage() then
    raise exception 'Only the Owner or HR can enter attendance.';
  end if;
  if p_date is null then
    raise exception 'Date is required.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Rows must be a list.';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Too many rows in one save.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    select * into v_emp from public.hr_employees where id = nullif(v_row ->> 'employee_id', '')::uuid;
    if v_emp.id is null then
      raise exception 'Employee not found.';
    end if;
    if v_emp.id = any (v_seen) then
      raise exception '% appears twice.', v_emp.full_name;
    end if;
    v_seen := v_seen || v_emp.id;
    if p_date < v_emp.join_date or (v_emp.leave_date is not null and p_date > v_emp.leave_date) then
      raise exception '% was not employed on %.', v_emp.full_name, to_char(p_date, 'DD-Mon-YYYY');
    end if;
    if public._fn_hr_day_locked(v_emp.id, p_date) then
      raise exception 'Salary for % on % is already finalised. Cancel that salary sheet first to change it.',
        v_emp.full_name, to_char(p_date, 'DD-Mon-YYYY');
    end if;

    v_mark := nullif(v_row ->> 'mark', '');
    if v_mark is null then
      delete from public.hr_attendance where employee_id = v_emp.id and work_date = p_date;
      v_count := v_count + 1;
      continue;
    end if;
    if v_mark not in ('present', 'absent', 'leave') then
      raise exception 'Unknown mark "%" for %.', v_mark, v_emp.full_name;
    end if;
    if v_mark <> 'leave' and p_date > v_today then
      raise exception 'Attendance for % cannot be entered for a future date (only leave can).', v_emp.full_name;
    end if;

    v_in := null; v_out := null; v_clean_pairs := '[]'::jsonb; v_leave_type := null; v_fraction := null;

    if v_mark = 'leave' then
      v_leave_type := nullif(v_row ->> 'leave_type_id', '')::uuid;
      if v_leave_type is null or not exists (select 1 from public.hr_leave_types where id = v_leave_type and is_active) then
        raise exception 'Pick a leave type for %.', v_emp.full_name;
      end if;
      v_fraction := coalesce(nullif(v_row ->> 'leave_fraction', '')::numeric, 1);
      if v_fraction not in (0.5, 1) then
        raise exception 'Leave must be a full day or half day (%).', v_emp.full_name;
      end if;
    end if;

    if v_mark = 'present' or (v_mark = 'leave' and v_fraction = 0.5) then
      if nullif(v_row ->> 'check_in', '') is not null then
        if (v_row ->> 'check_in') !~ v_time_re then raise exception 'In time for % must be like 09:00.', v_emp.full_name; end if;
        v_in := (v_row ->> 'check_in')::time;
      end if;
      if nullif(v_row ->> 'check_out', '') is not null then
        if (v_row ->> 'check_out') !~ v_time_re then raise exception 'Out time for % must be like 18:00.', v_emp.full_name; end if;
        v_out := (v_row ->> 'check_out')::time;
      end if;
      v_pairs := coalesce(v_row -> 'extra_pairs', '[]'::jsonb);
      if jsonb_typeof(v_pairs) <> 'array' then
        raise exception 'Extra In/Out pairs must be a list.';
      end if;
      for v_pair in select value from jsonb_array_elements(v_pairs) loop
        if nullif(v_pair ->> 'in', '') is null and nullif(v_pair ->> 'out', '') is null then
          continue;
        end if;
        if coalesce(v_pair ->> 'in', '') !~ v_time_re or coalesce(v_pair ->> 'out', '') !~ v_time_re then
          raise exception 'Each extra In/Out pair for % needs both times, like 14:00.', v_emp.full_name;
        end if;
        v_clean_pairs := v_clean_pairs || jsonb_build_array(jsonb_build_object('in', v_pair ->> 'in', 'out', v_pair ->> 'out'));
      end loop;
      if jsonb_array_length(v_clean_pairs) > 4 then
        raise exception 'At most 4 extra In/Out pairs (%).', v_emp.full_name;
      end if;
      if jsonb_array_length(v_clean_pairs) > 0 and (v_in is null or v_out is null) then
        raise exception 'Fill the main In and Out for % before extra pairs.', v_emp.full_name;
      end if;
    end if;

    insert into public.hr_attendance (employee_id, work_date, mark, check_in, check_out, extra_pairs, leave_type_id, leave_fraction, note)
    values (v_emp.id, p_date, v_mark, v_in, v_out, v_clean_pairs, v_leave_type, v_fraction,
            nullif(btrim(coalesce(v_row ->> 'note', '')), ''))
    on conflict (employee_id, work_date) do update
      set mark = excluded.mark, check_in = excluded.check_in, check_out = excluded.check_out,
          extra_pairs = excluded.extra_pairs, leave_type_id = excluded.leave_type_id,
          leave_fraction = excluded.leave_fraction, note = excluded.note, updated_by = auth.uid()
      where (public.hr_attendance.mark, public.hr_attendance.check_in, public.hr_attendance.check_out,
             public.hr_attendance.extra_pairs, public.hr_attendance.leave_type_id,
             public.hr_attendance.leave_fraction, public.hr_attendance.note)
        is distinct from
            (excluded.mark, excluded.check_in, excluded.check_out, excluded.extra_pairs,
             excluded.leave_type_id, excluded.leave_fraction, excluded.note);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Holidays and leave types: maintenance
-- ---------------------------------------------------------------------------
create or replace function public.fn_hr_add_holiday(p_date date, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.fn_hr_can_manage() then
    raise exception 'Only the Owner or HR can manage holidays.';
  end if;
  if p_date is null then
    raise exception 'Date is required.';
  end if;
  if public._fn_hr_day_locked(null, p_date) then
    raise exception 'Salary covering % is already finalised.', to_char(p_date, 'DD-Mon-YYYY');
  end if;
  if exists (select 1 from public.hr_holidays where holiday_date = p_date) then
    raise exception '% is already a holiday.', to_char(p_date, 'DD-Mon-YYYY');
  end if;
  insert into public.hr_holidays (holiday_date, name) values (p_date, btrim(coalesce(p_name, '')))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.fn_hr_delete_holiday(p_holiday_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date;
begin
  if not public.fn_hr_can_manage() then
    raise exception 'Only the Owner or HR can manage holidays.';
  end if;
  select holiday_date into v_date from public.hr_holidays where id = p_holiday_id;
  if v_date is null then
    raise exception 'Holiday not found.';
  end if;
  if public._fn_hr_day_locked(null, v_date) then
    raise exception 'Salary covering % is already finalised.', to_char(v_date, 'DD-Mon-YYYY');
  end if;
  delete from public.hr_holidays where id = p_holiday_id;
end;
$$;

create or replace function public.fn_hr_save_leave_type(p_id uuid, p_name text, p_is_paid boolean, p_is_active boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_old public.hr_leave_types;
begin
  if not public.fn_hr_can_manage() then
    raise exception 'Only the Owner or HR can manage leave types.';
  end if;
  if p_is_paid is null then
    raise exception 'Choose paid or unpaid.';
  end if;
  if exists (
    select 1 from public.hr_leave_types
    where lower(btrim(name)) = lower(btrim(coalesce(p_name, ''))) and id is distinct from p_id
  ) then
    raise exception 'A leave type named "%" already exists.', btrim(p_name);
  end if;

  if p_id is null then
    insert into public.hr_leave_types (name, is_paid, is_active)
    values (btrim(coalesce(p_name, '')), p_is_paid, coalesce(p_is_active, true))
    returning id into v_id;
    return v_id;
  end if;

  select * into v_old from public.hr_leave_types where id = p_id for update;
  if v_old.id is null then
    raise exception 'Leave type not found.';
  end if;
  -- Paid/unpaid decides past pay, so it is fixed once the type is used.
  if v_old.is_paid <> p_is_paid and exists (select 1 from public.hr_attendance where leave_type_id = p_id) then
    raise exception 'This leave type is already used, so paid/unpaid cannot change. Add a new leave type instead.';
  end if;
  update public.hr_leave_types
  set name = btrim(coalesce(p_name, '')), is_paid = p_is_paid, is_active = coalesce(p_is_active, is_active)
  where id = p_id;
  return p_id;
end;
$$;

-- Leave types that some attendance entry uses (their paid/unpaid is fixed).
create or replace function public.fn_hr_used_leave_types()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct a.leave_type_id), '{}')
  from public.hr_attendance a
  where public.fn_hr_can_read() and a.leave_type_id is not null;
$$;

-- ---------------------------------------------------------------------------
-- 9. Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public._fn_hr_day_locked(uuid, date) from public, anon, authenticated;
revoke execute on function public._fn_hr_rules_on(uuid, date) from public, anon, authenticated;
revoke execute on function public.fn_hr_locked_employees(date) from public, anon;
grant execute on function public.fn_hr_locked_employees(date) to authenticated;
revoke execute on function public.fn_hr_used_leave_types() from public, anon;
grant execute on function public.fn_hr_used_leave_types() to authenticated;
revoke execute on function public._fn_hr_entry_pairs(public.hr_attendance) from public, anon, authenticated;
revoke execute on function public._fn_hr_day_kind(jsonb, date) from public, anon, authenticated;
revoke execute on function public.fn_hr_calc_day(jsonb, text, text, jsonb, numeric) from public, anon;
revoke execute on function public.fn_hr_day_results(date, date, uuid[]) from public, anon;
revoke execute on function public.fn_hr_save_attendance(date, jsonb) from public, anon;
revoke execute on function public.fn_hr_add_holiday(date, text) from public, anon;
revoke execute on function public.fn_hr_delete_holiday(uuid) from public, anon;
revoke execute on function public.fn_hr_save_leave_type(uuid, text, boolean, boolean) from public, anon;

grant execute on function public.fn_hr_calc_day(jsonb, text, text, jsonb, numeric) to authenticated;
grant execute on function public.fn_hr_day_results(date, date, uuid[]) to authenticated;
grant execute on function public.fn_hr_save_attendance(date, jsonb) to authenticated;
grant execute on function public.fn_hr_add_holiday(date, text) to authenticated;
grant execute on function public.fn_hr_delete_holiday(uuid) to authenticated;
grant execute on function public.fn_hr_save_leave_type(uuid, text, boolean, boolean) to authenticated;
