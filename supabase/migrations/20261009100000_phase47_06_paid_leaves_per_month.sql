-- Phase 47.06: paid leaves are allowed per MONTH, not per year.
--
-- The policy rule paid_leaves_per_year (default 12) becomes
-- paid_leaves_per_month (default 1, 0 to 31 in half days). Each calendar
-- month has its own allowance: paid-type leave beyond it in that month is
-- paid as unpaid leave, and what is left over does not carry to the next
-- month. The first month of a new employee gets the full allowance.
--
-- Changes: default rules, rule validation, the salary line calculation (the
-- allowance is counted per month, also when a salary period crosses months),
-- and the leave balance function (now per month instead of per year).
-- Rule sets already stored with the old key are converted (year / 12,
-- rounded to half days).

CREATE OR REPLACE FUNCTION public.fn_hr_default_rules()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
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
    'paid_leaves_per_month', 1
  );
$function$;

CREATE OR REPLACE FUNCTION public.fn_hr_validate_rules(p_rules jsonb, p_full boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
    'wager_week_start', 'Pay week starts on', 'paid_leaves_per_month', 'Paid leaves per month'
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

    elsif v_key = 'paid_leaves_per_month' then
      if jsonb_typeof(v_val) <> 'number' then
        raise exception 'Paid leaves per month must be a number.';
      end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < 0 or v_num > 31 or v_num * 2 <> trunc(v_num * 2) then
        raise exception 'Paid leaves per month must be 0 to 31, in half days.';
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
$function$;

CREATE OR REPLACE FUNCTION public._fn_hr_compute_line(p_employee_id uuid, p_kind text, p_cycle text, p_from date, p_to date, p_sheet_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_all jsonb;
  v_n int;
  v_i int;
  v_j int;
  d jsonb;
  c jsonb;
  r jsonb;
  v_date date;
  v_kind text;
  v_type text;
  v_basis text;
  v_rate numeric;
  v_ps int;
  v_wd int;
  v_wd_cache jsonb := '{}'::jsonb;
  v_per_day numeric;
  v_min_rate numeric;
  v_wv numeric;
  v_lv numeric;
  v_paid_lv numeric;
  v_unpaid_lv numeric;
  v_used jsonb := '{}'::jsonb;
  v_year text;
  v_quota numeric;
  v_day_pay numeric;
  v_day_ot numeric;
  v_ot_min int;
  v_sw boolean;
  v_prev jsonb;
  v_next jsonb;
  v_days jsonb := '[]'::jsonb;
  v_count int := 0;
  v_working numeric := 0;
  v_present numeric := 0;
  v_absent numeric := 0;
  v_paid_leave numeric := 0;
  v_unpaid_leave numeric := 0;
  v_late_count int := 0;
  v_ot_total int := 0;
  v_sandwich_days int := 0;
  v_base numeric := 0;
  v_ot_pay numeric := 0;
  v_late_ded numeric := 0;
  v_early_ded numeric := 0;
  v_sandwich_ded numeric := 0;
  v_last_rules jsonb;
  v_last_type text;
  v_last_basis text;
  v_last_rate numeric;
  v_last_day_rate numeric;
  v_count_ded numeric := 0;
  v_join date;
begin
  select join_date into v_join from public.hr_employees where id = p_employee_id;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.work_date), '[]'::jsonb) into v_all
  from public.fn_hr_day_results(p_from - 7, p_to + 7, array[p_employee_id]) x;
  v_n := jsonb_array_length(v_all);

  -- Paid leave already used this month before the period (permanent days).
  select coalesce(jsonb_object_agg(y, used), '{}'::jsonb) into v_used
  from (
    select to_char(a.work_date, 'YYYY-MM') as y, sum(a.leave_fraction) as used
    from public.hr_attendance a
    join public.hr_leave_types lt on lt.id = a.leave_type_id and lt.is_paid
    where a.employee_id = p_employee_id and a.mark = 'leave'
      and a.work_date >= date_trunc('month', p_from)::date and a.work_date < p_from
      and (public.fn_hr_terms_on(p_employee_id, a.work_date)).employee_type = 'permanent'
      and public._fn_hr_day_kind(public._fn_hr_rules_on(p_employee_id, a.work_date), a.work_date) = 'work'
    group by 1
  ) u;

  for v_i in 0 .. v_n - 1 loop
    d := v_all -> v_i;
    v_date := (d ->> 'work_date')::date;
    continue when v_date < p_from or v_date > p_to;
    r := d -> 'rules';
    v_type := d ->> 'employee_type';
    continue when not public._fn_hr_day_on_sheet(p_kind, p_cycle, v_type, r);
    -- Already paid on another finalised sheet.
    continue when exists (
      select 1 from public.hr_salary_days s
      where s.employee_id = p_employee_id and s.work_date = v_date and s.sheet_id is distinct from p_sheet_id
    );

    c := d -> 'calc';
    v_kind := d ->> 'day_kind';
    v_basis := coalesce(d ->> 'wage_basis', 'monthly');
    v_ps := greatest(public._fn_hr_paid_shift(r), 1);
    v_wv := (c ->> 'work_value')::numeric;
    v_lv := (c ->> 'leave_value')::numeric;
    v_paid_lv := 0;
    v_unpaid_lv := v_lv;
    v_day_pay := 0;
    v_day_ot := 0;
    v_ot_min := 0;
    v_sw := false;
    v_count := v_count + 1;

    if v_type = 'permanent' then
      if not v_wd_cache ? to_char(v_date, 'YYYY-MM') then
        v_wd_cache := v_wd_cache || jsonb_build_object(to_char(v_date, 'YYYY-MM'), public._fn_hr_month_working_days(p_employee_id, v_date));
      end if;
      v_wd := (v_wd_cache ->> to_char(v_date, 'YYYY-MM'))::int;
      v_rate := (d ->> 'monthly_salary')::numeric;
      v_per_day := case when v_wd > 0 then v_rate / v_wd else 0 end;
      v_min_rate := v_per_day / v_ps;
      v_last_day_rate := v_per_day;

      if v_kind = 'work' then
        v_working := v_working + 1;
        if v_lv > 0 and coalesce((d ->> 'leave_paid')::boolean, false) then
          v_year := to_char(v_date, 'YYYY-MM');
          v_quota := (r ->> 'paid_leaves_per_month')::numeric;
          v_paid_lv := least(v_lv, greatest(v_quota - coalesce((v_used ->> v_year)::numeric, 0), 0));
          v_unpaid_lv := v_lv - v_paid_lv;
          v_used := v_used || jsonb_build_object(v_year, coalesce((v_used ->> v_year)::numeric, 0) + v_paid_lv);
        end if;
        v_day_pay := v_per_day * (v_wv + v_paid_lv);
        v_present := v_present + v_wv;
        v_absent := v_absent + greatest(1 - v_wv - v_lv, 0);
        v_paid_leave := v_paid_leave + v_paid_lv;
        v_unpaid_leave := v_unpaid_leave + v_unpaid_lv;
        v_late_ded := v_late_ded + (c ->> 'late_cut')::int * v_min_rate;
        v_early_ded := v_early_ded + (c ->> 'early_cut')::int * v_min_rate;
        if (c ->> 'late_counted')::boolean then v_late_count := v_late_count + 1; end if;
        v_ot_min := (c ->> 'ot')::int;
      else
        v_ot_min := (c ->> 'offday_ot')::int;
        -- Sandwich: nearest working day on each side both fully unpaid.
        if (r ->> 'sandwich_rule')::boolean then
          v_prev := null;
          v_next := null;
          for v_j in reverse v_i - 1 .. 0 loop
            if (v_all -> v_j ->> 'day_kind') = 'work' then v_prev := v_all -> v_j; exit; end if;
          end loop;
          for v_j in v_i + 1 .. v_n - 1 loop
            if (v_all -> v_j ->> 'day_kind') = 'work' then v_next := v_all -> v_j; exit; end if;
          end loop;
          if v_prev is not null and v_next is not null
             and (v_next ->> 'work_date')::date <= v_today
             and (v_prev -> 'calc' ->> 'status' in ('A', 'NE') or (v_prev -> 'calc' ->> 'status' = 'L' and not coalesce((v_prev ->> 'leave_paid')::boolean, false)))
             and (v_next -> 'calc' ->> 'status' in ('A', 'NE') or (v_next -> 'calc' ->> 'status' = 'L' and not coalesce((v_next ->> 'leave_paid')::boolean, false)))
          then
            v_sw := true;
            v_sandwich_days := v_sandwich_days + 1;
            v_sandwich_ded := v_sandwich_ded + v_per_day;
          end if;
        end if;
      end if;
    else
      v_rate := (d ->> 'wage_rate')::numeric;
      if v_kind = 'work' then
        v_working := v_working + 1;
        v_absent := v_absent + greatest(1 - v_wv - v_lv, 0);
        v_unpaid_leave := v_unpaid_leave + v_lv;
      end if;
      v_present := v_present + v_wv;
      v_ot_min := (c ->> 'ot')::int;
      if v_basis = 'per_minute' then
        v_min_rate := v_rate;
        v_day_pay := v_rate * (c ->> 'normal')::int;
        v_last_day_rate := v_rate * v_ps;
      else
        v_min_rate := v_rate / v_ps;
        v_day_pay := v_rate * v_wv;
        v_late_ded := v_late_ded + (c ->> 'late_cut')::int * v_min_rate;
        v_early_ded := v_early_ded + (c ->> 'early_cut')::int * v_min_rate;
        if (c ->> 'late_counted')::boolean then v_late_count := v_late_count + 1; end if;
        v_last_day_rate := v_rate;
      end if;
    end if;

    if v_ot_min > 0 then
      v_day_ot := case when (r ->> 'ot_rate_type') = 'multiplier'
                       then v_ot_min * v_min_rate * (r ->> 'ot_rate')::numeric
                       else v_ot_min / 60.0 * (r ->> 'ot_rate')::numeric end;
    end if;

    v_base := v_base + v_day_pay;
    v_ot_pay := v_ot_pay + v_day_ot;
    v_ot_total := v_ot_total + v_ot_min;
    v_last_rules := r;
    v_last_type := v_type;
    v_last_basis := v_basis;
    v_last_rate := v_rate;

    v_days := v_days || jsonb_build_array(jsonb_build_object(
      'd', v_date, 'k', v_kind, 's', c ->> 'status', 'g', d ->> 'policy_group_id',
      'wv', v_wv, 'pl', v_paid_lv, 'ul', v_unpaid_lv,
      'net', (c ->> 'net')::int, 'late', (c ->> 'late')::int, 'early', (c ->> 'early')::int,
      'ot', v_ot_min, 'sw', v_sw, 'pay', round(v_day_pay, 2), 'otpay', round(v_day_ot, 2)));
  end loop;

  if v_count = 0 then
    return null;
  end if;

  if (v_last_rules ->> 'late_mode') = 'count' and v_late_count > 0 then
    v_count_ded := floor(v_late_count / (v_last_rules ->> 'late_count_per_deduction')::numeric)
                   * (v_last_rules ->> 'late_deduction_days')::numeric * coalesce(v_last_day_rate, 0);
    v_late_ded := v_late_ded + v_count_ded;
  end if;

  return jsonb_build_object(
    'employee_type', v_last_type,
    'pay_basis', v_last_basis,
    'rate', round(coalesce(v_last_rate, 0), 4),
    'days_count', v_count,
    'working_days', v_working,
    'present_days', v_present,
    'absent_days', v_absent,
    'paid_leave_days', v_paid_leave,
    'unpaid_leave_days', v_unpaid_leave,
    'late_count', v_late_count,
    'ot_minutes', v_ot_total,
    'sandwich_days', v_sandwich_days,
    'base_pay', round(v_base, 2),
    'ot_pay', round(v_ot_pay, 2),
    'late_deduction', round(v_late_ded, 2),
    'early_deduction', round(v_early_ded, 2),
    'sandwich_deduction', round(v_sandwich_ded, 2),
    'days', v_days
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Convert stored rule sets (policy versions and per-employee overrides)
-- ---------------------------------------------------------------------------
update public.hr_policy_versions
set rules = (rules - 'paid_leaves_per_year')
  || jsonb_build_object('paid_leaves_per_month', least(31, round((rules ->> 'paid_leaves_per_year')::numeric / 12 * 2) / 2))
where rules ? 'paid_leaves_per_year';

update public.hr_employee_terms
set rule_overrides = (rule_overrides - 'paid_leaves_per_year')
  || jsonb_build_object('paid_leaves_per_month', least(31, round((rule_overrides ->> 'paid_leaves_per_year')::numeric / 12 * 2) / 2))
where rule_overrides ? 'paid_leaves_per_year';

-- ---------------------------------------------------------------------------
-- Leave balance, per month
-- ---------------------------------------------------------------------------
-- p_month is any date inside the month. Quota is the monthly allowance in
-- force on the last day of the month (or today for the current month); used
-- = paid-type leave taken on working days while permanent, capped at the
-- quota day by day.
drop function if exists public.fn_hr_leave_balance(int, uuid[]);

create or replace function public.fn_hr_leave_balance(p_month date, p_employee_ids uuid[] default null)
returns table (employee_id uuid, quota numeric, used numeric, unpaid_extra numeric, remaining numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  e record;
  a record;
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_quota numeric;
  v_used numeric;
  v_extra numeric;
  v_q numeric;
  v_take numeric;
  v_asof date;
begin
  if not public.fn_hr_can_read() then
    raise exception 'Not allowed.';
  end if;
  if p_month is null then
    raise exception 'Month is required.';
  end if;
  v_asof := least(v_to, greatest((now() at time zone 'Asia/Karachi')::date, v_from));
  for e in
    select x.id, x.join_date, x.leave_date from public.hr_employees x
    where (p_employee_ids is null or x.id = any (p_employee_ids))
      and x.join_date <= v_to
      and (x.leave_date is null or x.leave_date >= v_from)
  loop
    v_used := 0;
    v_extra := 0;
    for a in
      select w.work_date, w.leave_fraction, public._fn_hr_rules_on(e.id, w.work_date) as r
      from public.hr_attendance w
      join public.hr_leave_types lt on lt.id = w.leave_type_id and lt.is_paid
      where w.employee_id = e.id and w.mark = 'leave'
        and w.work_date between v_from and v_to
        and (public.fn_hr_terms_on(e.id, w.work_date)).employee_type = 'permanent'
      order by w.work_date
    loop
      continue when public._fn_hr_day_kind(a.r, a.work_date) <> 'work';
      v_q := (a.r ->> 'paid_leaves_per_month')::numeric;
      v_take := least(a.leave_fraction, greatest(v_q - v_used, 0));
      v_used := v_used + v_take;
      v_extra := v_extra + (a.leave_fraction - v_take);
    end loop;
    v_quota := coalesce((public._fn_hr_rules_on(e.id, greatest(least(v_asof, coalesce(e.leave_date, v_asof)), e.join_date)) ->> 'paid_leaves_per_month')::numeric, 0);
    employee_id := e.id;
    quota := v_quota;
    used := v_used;
    unpaid_extra := v_extra;
    remaining := greatest(v_quota - v_used, 0);
    return next;
  end loop;
end;
$$;

revoke execute on function public.fn_hr_leave_balance(date, uuid[]) from public, anon;
grant execute on function public.fn_hr_leave_balance(date, uuid[]) to authenticated;
