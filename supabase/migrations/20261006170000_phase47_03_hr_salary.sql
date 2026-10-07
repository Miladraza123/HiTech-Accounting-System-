-- Phase 47.03: HR / Attendance, parts (c) and (d): salary sheets, paid
-- leave quota, sandwich rule, advances, and the optional salary journal.
--
-- How pay is worked out (every figure comes from fn_hr_day_results, so the
-- rules, terms and holidays in force on each day are used):
--
--  Permanent
--   per-day pay  = that day's monthly salary ÷ working days of that month
--                  (days whose weekday is a working day in that day's
--                  rules, minus holidays)
--   base pay     = Σ per-day pay × (day worked + paid leave) on working
--                  days. Off days and holidays are already inside the
--                  monthly salary.
--   paid leave   = paid-type leave up to the yearly quota
--                  (paid_leaves_per_year, calendar year); beyond it, unpaid
--   sandwich     = an off day / holiday whose nearest working day before
--                  and after are both full unpaid absences: one more day's
--                  pay is cut (when the rule is on)
--   overtime     = minutes past a full shift, plus all minutes worked on an
--                  off day / holiday
--  Daily wager (per day)    base = day rate × day worked, any day
--  Daily wager (per minute) base = minute rate × paid minutes (up to a
--                                  full shift); late / early are simply
--                                  unpaid minutes, so no extra cut
--  Minute rate (late / early cuts, overtime) = per-day pay ÷ paid shift
--  minutes (per-minute wagers: their own rate).
--  "Every N lates" policy: floor(lates ÷ N) × days deducted × day rate.
--
--  gross = base + overtime + bonus − late − early − sandwich − other cuts
--  net   = gross − advance recovered
--
-- Lifecycle: Draft (recalculate / adjust freely) → Finalized (days are
-- locked; journal posted when HR Settings has it on) → Paid (payment
-- posted when the sheet has a journal). Cancelling reverses what was
-- posted and unlocks the days.

-- ---------------------------------------------------------------------------
-- 1. Accounts and numbering
-- ---------------------------------------------------------------------------
insert into public.chart_of_accounts (code, name, account_type, is_system) values
  ('1150', 'Employee Advances', 'asset', true),
  ('2200', 'Salaries & Wages Payable', 'liability', true),
  ('6500', 'Salaries & Wages', 'expense', true)
on conflict (code) do nothing;

insert into public.numbering_sequences (doc_type, label, prefix) values
  ('SAL', 'Salary Sheet', 'SAL-'),
  ('ADV', 'Employee Advance', 'ADV-')
on conflict (doc_type) do nothing;

create or replace function public.fn_hr_can_pay()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_owner() or public.has_role('accounts');
$$;

-- Draft salary work (generate, recalculate, bonus / cuts): Owner, HR, Accounts.
create or replace function public.fn_hr_can_prepare_salary()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_owner() or public.has_role('hr') or public.has_role('accounts');
$$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table public.hr_advances (
  id uuid primary key default gen_random_uuid(),
  advance_no text not null unique,
  employee_id uuid not null references public.hr_employees(id) on delete restrict,
  advance_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  installment numeric(14,2) not null check (installment > 0),
  payment_source text not null check (payment_source in ('cash', 'bank', 'petty_cash')),
  bank_account_id uuid references public.bank_accounts(id),
  petty_cash_fund_id uuid references public.petty_cash_funds(id),
  journal_entry_id uuid references public.journal_entries(id),
  note text,
  status text not null default 'Active' check (status in ('Active', 'Cancelled')),
  cancel_reason text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_advances_source_chk check (
    (payment_source = 'bank' and bank_account_id is not null and petty_cash_fund_id is null)
    or (payment_source = 'petty_cash' and petty_cash_fund_id is not null and bank_account_id is null)
    or (payment_source = 'cash' and bank_account_id is null and petty_cash_fund_id is null)
  )
);
create index hr_advances_employee_idx on public.hr_advances (employee_id);

create table public.hr_salary_sheets (
  id uuid primary key default gen_random_uuid(),
  sheet_no text not null unique,
  kind text not null check (kind in ('monthly', 'wager')),
  wager_cycle text check (wager_cycle in ('weekly', 'fortnightly', 'monthly')),
  period_from date not null,
  period_to date not null,
  status text not null default 'Draft' check (status in ('Draft', 'Finalized', 'Paid', 'Cancelled')),
  gross_total numeric(14,2) not null default 0,
  advance_total numeric(14,2) not null default 0,
  net_total numeric(14,2) not null default 0,
  journal_entry_id uuid references public.journal_entries(id),
  paid_on date,
  payment_source text check (payment_source in ('cash', 'bank', 'petty_cash')),
  bank_account_id uuid references public.bank_accounts(id),
  petty_cash_fund_id uuid references public.petty_cash_funds(id),
  payment_journal_entry_id uuid references public.journal_entries(id),
  note text,
  cancel_reason text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  finalized_by uuid references public.profiles(id),
  finalized_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint hr_salary_sheets_period_chk check (period_to >= period_from),
  constraint hr_salary_sheets_kind_chk check ((kind = 'monthly') = (wager_cycle is null))
);
create index hr_salary_sheets_period_idx on public.hr_salary_sheets (period_from, period_to);

create table public.hr_salary_lines (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.hr_salary_sheets(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete restrict,
  employee_type text not null,
  pay_basis text not null,
  rate numeric(14,4) not null default 0,
  days_count int not null default 0,
  working_days numeric(6,2) not null default 0,
  present_days numeric(6,2) not null default 0,
  absent_days numeric(6,2) not null default 0,
  paid_leave_days numeric(6,2) not null default 0,
  unpaid_leave_days numeric(6,2) not null default 0,
  late_count int not null default 0,
  ot_minutes int not null default 0,
  sandwich_days int not null default 0,
  base_pay numeric(14,2) not null default 0,
  ot_pay numeric(14,2) not null default 0,
  late_deduction numeric(14,2) not null default 0,
  early_deduction numeric(14,2) not null default 0,
  sandwich_deduction numeric(14,2) not null default 0,
  bonus numeric(14,2) not null default 0 check (bonus >= 0),
  other_deduction numeric(14,2) not null default 0 check (other_deduction >= 0),
  adjustment_note text,
  gross numeric(14,2) not null default 0,
  advance_recovery numeric(14,2) not null default 0 check (advance_recovery >= 0),
  net numeric(14,2) not null default 0,
  days jsonb not null default '[]'::jsonb,
  unique (sheet_id, employee_id)
);
create index hr_salary_lines_employee_idx on public.hr_salary_lines (employee_id);

-- Days covered by a finalised (or paid) sheet: the lock, and the guard
-- against paying one day twice.
create table public.hr_salary_days (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.hr_salary_sheets(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete restrict,
  work_date date not null,
  policy_group_id uuid references public.hr_policy_groups(id),
  unique (employee_id, work_date)
);
create index hr_salary_days_group_idx on public.hr_salary_days (policy_group_id, work_date);
create index hr_salary_days_date_idx on public.hr_salary_days (work_date);

-- Which advance a finalised line's recovery paid back (oldest first).
create table public.hr_advance_recoveries (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.hr_salary_lines(id) on delete cascade,
  advance_id uuid not null references public.hr_advances(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0)
);
create index hr_advance_recoveries_advance_idx on public.hr_advance_recoveries (advance_id);

create trigger trg_updated_at before update on public.hr_advances for each row execute function public.fn_set_updated_at();
create trigger trg_updated_at before update on public.hr_salary_sheets for each row execute function public.fn_set_updated_at();
create trigger trg_audit after insert or update or delete on public.hr_advances for each row execute function public.fn_audit_row();
create trigger trg_audit after insert or update or delete on public.hr_salary_sheets for each row execute function public.fn_audit_row();

alter table public.hr_advances enable row level security;
alter table public.hr_salary_sheets enable row level security;
alter table public.hr_salary_lines enable row level security;
alter table public.hr_salary_days enable row level security;
alter table public.hr_advance_recoveries enable row level security;
create policy p_select on public.hr_advances for select to authenticated using (public.fn_hr_can_read());
create policy p_select on public.hr_salary_sheets for select to authenticated using (public.fn_hr_can_read());
create policy p_select on public.hr_salary_lines for select to authenticated using (public.fn_hr_can_read());
create policy p_select on public.hr_salary_days for select to authenticated using (public.fn_hr_can_read());
create policy p_select on public.hr_advance_recoveries for select to authenticated using (public.fn_hr_can_read());
revoke all on public.hr_advances, public.hr_salary_sheets, public.hr_salary_lines, public.hr_salary_days,
  public.hr_advance_recoveries from anon, authenticated;
grant select on public.hr_advances, public.hr_salary_sheets, public.hr_salary_lines, public.hr_salary_days,
  public.hr_advance_recoveries to authenticated;

-- Outstanding balance per advance (recoveries count once their sheet is
-- finalised; a cancelled sheet's recoveries are deleted with it).
create or replace view public.hr_advance_balances
with (security_invoker = true)
as
select
  a.id, a.advance_no, a.employee_id, a.advance_date, a.amount, a.installment, a.status,
  coalesce((select sum(r.amount) from public.hr_advance_recoveries r where r.advance_id = a.id), 0) as recovered,
  case when a.status = 'Active'
       then a.amount - coalesce((select sum(r.amount) from public.hr_advance_recoveries r where r.advance_id = a.id), 0)
       else 0 end as outstanding
from public.hr_advances a;
revoke all on public.hr_advance_balances from anon, authenticated;
grant select on public.hr_advance_balances to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Locks (real bodies for the hooks from 47.01 / 47.02)
-- ---------------------------------------------------------------------------
create or replace function public._fn_hr_day_locked(p_employee_id uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.hr_salary_days d
    where d.work_date = p_date and (p_employee_id is null or d.employee_id = p_employee_id)
  );
$$;

create or replace function public._fn_hr_assert_terms_open(p_employee_id uuid, p_from date)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_last date;
begin
  select max(work_date) into v_last from public.hr_salary_days
  where employee_id = p_employee_id and work_date >= p_from;
  if v_last is not null then
    raise exception 'Salary is already finalised up to % for this employee. Choose a date after it, or cancel that salary sheet first.',
      to_char(v_last, 'DD-Mon-YYYY');
  end if;
end;
$$;

create or replace function public._fn_hr_assert_group_open(p_group_id uuid, p_from date)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_last date;
begin
  select max(work_date) into v_last from public.hr_salary_days
  where policy_group_id = p_group_id and work_date >= p_from;
  if v_last is not null then
    raise exception 'Salary on this policy is already finalised up to %. Choose a date after it, or cancel that salary sheet first.',
      to_char(v_last, 'DD-Mon-YYYY');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------------
-- Paid minutes of a full day under a rule set.
create or replace function public._fn_hr_paid_shift(p_rules jsonb)
returns int
language sql
immutable
set search_path = public
as $$
  select (case when e <= s then e + 1440 else e end) - s
         - case when (p_rules ->> 'break_paid')::boolean then 0 else (p_rules ->> 'break_minutes')::int end
  from (select split_part(p_rules ->> 'shift_start', ':', 1)::int * 60 + split_part(p_rules ->> 'shift_start', ':', 2)::int as s,
               split_part(p_rules ->> 'shift_end', ':', 1)::int * 60 + split_part(p_rules ->> 'shift_end', ':', 2)::int as e) x;
$$;

-- Working days in the calendar month of p_day for this employee: each day
-- of the month judged by the rules in force that day (days before joining
-- use the joining-date rules), minus holidays.
create or replace function public._fn_hr_month_working_days(p_employee_id uuid, p_day date)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.hr_employees e
  cross join generate_series(date_trunc('month', p_day)::date, (date_trunc('month', p_day) + interval '1 month - 1 day')::date, interval '1 day') g(d)
  where e.id = p_employee_id
    and public._fn_hr_day_kind(public._fn_hr_rules_on(p_employee_id, greatest(g.d::date, e.join_date)), g.d::date) = 'work';
$$;

-- Does this day belong on a sheet of this kind / cycle?
create or replace function public._fn_hr_day_on_sheet(p_kind text, p_cycle text, p_employee_type text, p_rules jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_kind = 'monthly' then p_employee_type = 'permanent' or (p_rules ->> 'wager_pay_cycle') = 'monthly'
    else p_employee_type = 'daily_wager' and (p_rules ->> 'wager_pay_cycle') = p_cycle
  end;
$$;

-- Outstanding advance balance for an employee (finalised recoveries only).
create or replace function public._fn_hr_advance_outstanding(p_employee_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(outstanding), 0) from public.hr_advance_balances where employee_id = p_employee_id;
$$;

-- What should be taken back this salary: each open advance's instalment,
-- never more than what is still owed.
create or replace function public._fn_hr_advance_due(p_employee_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(least(installment, outstanding)), 0)
  from public.hr_advance_balances where employee_id = p_employee_id and outstanding > 0;
$$;

-- ---------------------------------------------------------------------------
-- 5. One employee's line for a period
-- ---------------------------------------------------------------------------
-- Returns null when no day of the period belongs on this kind of sheet
-- (or every such day is already on another finalised sheet).
create or replace function public._fn_hr_compute_line(
  p_employee_id uuid,
  p_kind text,
  p_cycle text,
  p_from date,
  p_to date,
  p_sheet_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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

  -- Paid leave already used this year before the period (permanent days).
  select coalesce(jsonb_object_agg(y, used), '{}'::jsonb) into v_used
  from (
    select extract(year from a.work_date)::text as y, sum(a.leave_fraction) as used
    from public.hr_attendance a
    join public.hr_leave_types lt on lt.id = a.leave_type_id and lt.is_paid
    where a.employee_id = p_employee_id and a.mark = 'leave'
      and a.work_date >= make_date(extract(year from p_from)::int, 1, 1) and a.work_date < p_from
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
          v_year := extract(year from v_date)::text;
          v_quota := (r ->> 'paid_leaves_per_year')::numeric;
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
$$;

-- ---------------------------------------------------------------------------
-- 6. Sheet calculation (Draft)
-- ---------------------------------------------------------------------------
-- Recomputes every line of a draft sheet. Bonus, other cuts, note and the
-- advance recovery typed in are kept (recovery capped at what is owed and
-- at gross); p_default_recovery fills recovery for new lines with the
-- instalment due.
create or replace function public._fn_hr_compute_sheet(p_sheet_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.hr_salary_sheets;
  e record;
  v_line jsonb;
  v_old public.hr_salary_lines;
  v_gross numeric;
  v_rec numeric;
  v_ids uuid[] := '{}';
begin
  select * into s from public.hr_salary_sheets where id = p_sheet_id for update;

  for e in
    select id from public.hr_employees
    where join_date <= s.period_to and (leave_date is null or leave_date >= s.period_from)
    order by full_name
  loop
    v_line := public._fn_hr_compute_line(e.id, s.kind, s.wager_cycle, s.period_from, s.period_to, s.id);
    if v_line is null then
      continue;
    end if;
    v_ids := v_ids || e.id;
    select * into v_old from public.hr_salary_lines where sheet_id = s.id and employee_id = e.id;

    v_gross := (v_line ->> 'base_pay')::numeric + (v_line ->> 'ot_pay')::numeric + coalesce(v_old.bonus, 0)
             - (v_line ->> 'late_deduction')::numeric - (v_line ->> 'early_deduction')::numeric
             - (v_line ->> 'sandwich_deduction')::numeric - coalesce(v_old.other_deduction, 0);
    v_rec := case when v_old.id is null then public._fn_hr_advance_due(e.id) else v_old.advance_recovery end;
    v_rec := greatest(least(v_rec, public._fn_hr_advance_outstanding(e.id), greatest(v_gross, 0)), 0);

    insert into public.hr_salary_lines (
      sheet_id, employee_id, employee_type, pay_basis, rate, days_count, working_days, present_days, absent_days,
      paid_leave_days, unpaid_leave_days, late_count, ot_minutes, sandwich_days, base_pay, ot_pay,
      late_deduction, early_deduction, sandwich_deduction, bonus, other_deduction, adjustment_note,
      gross, advance_recovery, net, days)
    values (
      s.id, e.id, v_line ->> 'employee_type', v_line ->> 'pay_basis', (v_line ->> 'rate')::numeric,
      (v_line ->> 'days_count')::int, (v_line ->> 'working_days')::numeric, (v_line ->> 'present_days')::numeric,
      (v_line ->> 'absent_days')::numeric, (v_line ->> 'paid_leave_days')::numeric, (v_line ->> 'unpaid_leave_days')::numeric,
      (v_line ->> 'late_count')::int, (v_line ->> 'ot_minutes')::int, (v_line ->> 'sandwich_days')::int,
      (v_line ->> 'base_pay')::numeric, (v_line ->> 'ot_pay')::numeric, (v_line ->> 'late_deduction')::numeric,
      (v_line ->> 'early_deduction')::numeric, (v_line ->> 'sandwich_deduction')::numeric,
      coalesce(v_old.bonus, 0), coalesce(v_old.other_deduction, 0), v_old.adjustment_note,
      round(v_gross, 2), round(v_rec, 2), round(v_gross - v_rec, 2), v_line -> 'days')
    on conflict (sheet_id, employee_id) do update set
      employee_type = excluded.employee_type, pay_basis = excluded.pay_basis, rate = excluded.rate,
      days_count = excluded.days_count, working_days = excluded.working_days, present_days = excluded.present_days,
      absent_days = excluded.absent_days, paid_leave_days = excluded.paid_leave_days,
      unpaid_leave_days = excluded.unpaid_leave_days, late_count = excluded.late_count,
      ot_minutes = excluded.ot_minutes, sandwich_days = excluded.sandwich_days, base_pay = excluded.base_pay,
      ot_pay = excluded.ot_pay, late_deduction = excluded.late_deduction, early_deduction = excluded.early_deduction,
      sandwich_deduction = excluded.sandwich_deduction, gross = excluded.gross,
      advance_recovery = excluded.advance_recovery, net = excluded.net, days = excluded.days;
  end loop;

  delete from public.hr_salary_lines where sheet_id = s.id and not (employee_id = any (v_ids));

  update public.hr_salary_sheets
  set gross_total = coalesce((select sum(gross) from public.hr_salary_lines where sheet_id = s.id), 0),
      advance_total = coalesce((select sum(advance_recovery) from public.hr_salary_lines where sheet_id = s.id), 0),
      net_total = coalesce((select sum(net) from public.hr_salary_lines where sheet_id = s.id), 0)
  where id = s.id;
end;
$$;

create or replace function public.fn_hr_generate_salary_sheet(
  p_kind text,
  p_wager_cycle text,
  p_from date,
  p_to date,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_cycle text := case when p_kind = 'monthly' then null else p_wager_cycle end;
  v_clash text;
begin
  if not public.fn_hr_can_prepare_salary() then
    raise exception 'Only the Owner, HR or Accounts can prepare salary.';
  end if;
  if p_kind not in ('monthly', 'wager') or p_kind is null then
    raise exception 'Sheet kind must be monthly or wager.';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose a valid period.';
  end if;
  if p_kind = 'monthly' then
    if p_from <> date_trunc('month', p_from)::date or p_to <> (date_trunc('month', p_from) + interval '1 month - 1 day')::date then
      raise exception 'A monthly salary sheet must cover one whole calendar month.';
    end if;
  else
    if v_cycle not in ('weekly', 'fortnightly', 'monthly') or v_cycle is null then
      raise exception 'Choose the wager pay cycle (weekly, fortnightly or monthly).';
    end if;
    if p_to - p_from > 30 then
      raise exception 'A wager sheet can cover at most 31 days.';
    end if;
  end if;
  if p_from > (now() at time zone 'Asia/Karachi')::date then
    raise exception 'The period has not started yet.';
  end if;

  select sheet_no into v_clash from public.hr_salary_sheets
  where status <> 'Cancelled' and kind = p_kind and wager_cycle is not distinct from v_cycle
    and period_from <= p_to and period_to >= p_from
  limit 1;
  if v_clash is not null then
    raise exception 'Salary sheet % already covers part of this period.', v_clash;
  end if;

  insert into public.hr_salary_sheets (sheet_no, kind, wager_cycle, period_from, period_to, note)
  values (public.fn_get_next_number('SAL'), p_kind, v_cycle, p_from, p_to, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  perform public._fn_hr_compute_sheet(v_id);
  return v_id;
end;
$$;

create or replace function public.fn_hr_recalculate_salary_sheet(p_sheet_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.fn_hr_can_prepare_salary() then
    raise exception 'Only the Owner, HR or Accounts can prepare salary.';
  end if;
  select status into v_status from public.hr_salary_sheets where id = p_sheet_id for update;
  if v_status is null then
    raise exception 'Salary sheet not found.';
  end if;
  if v_status <> 'Draft' then
    raise exception 'Only a draft salary sheet can be recalculated.';
  end if;
  perform public._fn_hr_compute_sheet(p_sheet_id);
end;
$$;

create or replace function public.fn_hr_set_salary_adjustment(
  p_line_id uuid,
  p_bonus numeric,
  p_other_deduction numeric,
  p_advance_recovery numeric,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.hr_salary_lines;
  v_status text;
  v_gross numeric;
  v_owed numeric;
begin
  if not public.fn_hr_can_prepare_salary() then
    raise exception 'Only the Owner, HR or Accounts can prepare salary.';
  end if;
  select * into l from public.hr_salary_lines where id = p_line_id;
  if l.id is null then
    raise exception 'Salary line not found.';
  end if;
  select status into v_status from public.hr_salary_sheets where id = l.sheet_id for update;
  if v_status <> 'Draft' then
    raise exception 'Only a draft salary sheet can be changed.';
  end if;
  if coalesce(p_bonus, 0) < 0 or coalesce(p_other_deduction, 0) < 0 or coalesce(p_advance_recovery, 0) < 0 then
    raise exception 'Amounts cannot be negative.';
  end if;
  if (coalesce(p_bonus, 0) > 0 or coalesce(p_other_deduction, 0) > 0) and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Write a note for the bonus / deduction.';
  end if;

  v_gross := l.base_pay + l.ot_pay + round(coalesce(p_bonus, 0), 2) - l.late_deduction - l.early_deduction
           - l.sandwich_deduction - round(coalesce(p_other_deduction, 0), 2);
  v_owed := public._fn_hr_advance_outstanding(l.employee_id);
  if coalesce(p_advance_recovery, 0) > v_owed then
    raise exception 'Advance recovery (%) is more than the advance still owed (%).', p_advance_recovery, v_owed;
  end if;
  if coalesce(p_advance_recovery, 0) > greatest(v_gross, 0) then
    raise exception 'Advance recovery cannot be more than the gross pay (%).', round(v_gross, 2);
  end if;

  update public.hr_salary_lines
  set bonus = round(coalesce(p_bonus, 0), 2),
      other_deduction = round(coalesce(p_other_deduction, 0), 2),
      advance_recovery = round(coalesce(p_advance_recovery, 0), 2),
      adjustment_note = nullif(btrim(coalesce(p_note, '')), ''),
      gross = round(v_gross, 2),
      net = round(v_gross - coalesce(p_advance_recovery, 0), 2)
  where id = p_line_id;

  update public.hr_salary_sheets
  set gross_total = coalesce((select sum(gross) from public.hr_salary_lines where sheet_id = l.sheet_id), 0),
      advance_total = coalesce((select sum(advance_recovery) from public.hr_salary_lines where sheet_id = l.sheet_id), 0),
      net_total = coalesce((select sum(net) from public.hr_salary_lines where sheet_id = l.sheet_id), 0)
  where id = l.sheet_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Finalise / cancel / pay
-- ---------------------------------------------------------------------------
create or replace function public.fn_hr_finalize_salary_sheet(p_sheet_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.hr_salary_sheets;
  l record;
  a record;
  v_left numeric;
  v_take numeric;
  v_posted numeric := 0;
  v_unposted numeric := 0;
  v_bad text;
  v_clash record;
  v_lines jsonb := '[]'::jsonb;
  v_je uuid;
begin
  if not public.fn_hr_can_pay() then
    raise exception 'Only the Owner or Accounts can finalise salary.';
  end if;
  select * into s from public.hr_salary_sheets where id = p_sheet_id for update;
  if s.id is null then
    raise exception 'Salary sheet not found.';
  end if;
  if s.status <> 'Draft' then
    raise exception 'Only a draft salary sheet can be finalised.';
  end if;
  if s.period_to > (now() at time zone 'Asia/Karachi')::date then
    raise exception 'The period ends on %; finalise it after that.', to_char(s.period_to, 'DD-Mon-YYYY');
  end if;

  -- Fresh figures from today's attendance and rules.
  perform public._fn_hr_compute_sheet(p_sheet_id);
  select * into s from public.hr_salary_sheets where id = p_sheet_id;

  if not exists (select 1 from public.hr_salary_lines where sheet_id = p_sheet_id) then
    raise exception 'This salary sheet has no employees.';
  end if;
  select e.full_name into v_bad from public.hr_salary_lines x join public.hr_employees e on e.id = x.employee_id
  where x.sheet_id = p_sheet_id and (x.gross < 0 or x.net < 0) limit 1;
  if v_bad is not null then
    raise exception 'Deductions are more than the pay for %. Reduce the other deduction or advance recovery.', v_bad;
  end if;

  -- Lock the days (a clash means another sheet paid that day meanwhile).
  begin
    insert into public.hr_salary_days (sheet_id, employee_id, work_date, policy_group_id)
    select x.sheet_id, x.employee_id, (dd ->> 'd')::date, nullif(dd ->> 'g', '')::uuid
    from public.hr_salary_lines x
    cross join lateral jsonb_array_elements(x.days) dd
    where x.sheet_id = p_sheet_id;
  exception when unique_violation then
    select e.full_name, sd.work_date, sh.sheet_no into v_clash
    from public.hr_salary_lines x
    cross join lateral jsonb_array_elements(x.days) dd
    join public.hr_salary_days sd on sd.employee_id = x.employee_id and sd.work_date = (dd ->> 'd')::date
    join public.hr_salary_sheets sh on sh.id = sd.sheet_id
    join public.hr_employees e on e.id = x.employee_id
    where x.sheet_id = p_sheet_id
    limit 1;
    raise exception '% on % is already on salary sheet %.', v_clash.full_name, to_char(v_clash.work_date, 'DD-Mon-YYYY'), v_clash.sheet_no;
  end;

  -- Advance recovery: oldest advance first.
  for l in select x.id, x.employee_id, x.advance_recovery from public.hr_salary_lines x
           where x.sheet_id = p_sheet_id and x.advance_recovery > 0 loop
    if l.advance_recovery > public._fn_hr_advance_outstanding(l.employee_id) then
      raise exception 'An advance recovery is more than what is still owed. Recalculate the sheet.';
    end if;
    v_left := l.advance_recovery;
    for a in select b.id, b.outstanding, h.journal_entry_id
             from public.hr_advance_balances b join public.hr_advances h on h.id = b.id
             where b.employee_id = l.employee_id and b.outstanding > 0
             order by b.advance_date, b.advance_no loop
      exit when v_left <= 0;
      v_take := least(v_left, a.outstanding);
      insert into public.hr_advance_recoveries (line_id, advance_id, amount) values (l.id, a.id, v_take);
      if a.journal_entry_id is not null then v_posted := v_posted + v_take; else v_unposted := v_unposted + v_take; end if;
      v_left := v_left - v_take;
    end loop;
  end loop;

  if (select salary_journal_enabled from public.hr_settings limit 1) and s.gross_total > 0 then
    if s.gross_total - v_unposted > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '6500', 'debit', s.gross_total - v_unposted, 'credit', 0, 'memo', 'Salaries & wages'));
    end if;
    if s.net_total > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '2200', 'debit', 0, 'credit', s.net_total, 'memo', 'Net salary payable'));
    end if;
    if v_posted > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '1150', 'debit', 0, 'credit', v_posted, 'memo', 'Advances recovered'));
    end if;
    if jsonb_array_length(v_lines) >= 2 then
      v_je := public._fn_post_journal_entry_core(
        s.period_to,
        'Salary ' || s.sheet_no || ' (' || to_char(s.period_from, 'DD-Mon') || ' to ' || to_char(s.period_to, 'DD-Mon-YYYY') || ')',
        'hr_salary_sheets', s.id, v_lines);
    end if;
  end if;

  update public.hr_salary_sheets
  set status = 'Finalized', journal_entry_id = v_je, finalized_by = auth.uid(), finalized_at = now()
  where id = p_sheet_id;
end;
$$;

-- Reverses every line of a posted entry, dated today (Pakistan).
create or replace function public._fn_hr_reverse_entry(p_entry_id uuid, p_narration text, p_source_table text, p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lines jsonb;
begin
  select jsonb_agg(jsonb_build_object(
           'account_code', a.code, 'debit', l.credit, 'credit', l.debit,
           'bank_account_id', l.bank_account_id, 'petty_cash_fund_id', l.petty_cash_fund_id,
           'party_id', l.party_id, 'memo', coalesce(l.memo, '') || ' (reversed)'))
    into v_lines
  from public.journal_lines l join public.chart_of_accounts a on a.id = l.account_id
  where l.journal_entry_id = p_entry_id;
  if v_lines is null then
    return null;
  end if;
  return public._fn_post_journal_entry_core((now() at time zone 'Asia/Karachi')::date, p_narration, p_source_table, p_source_id, v_lines);
end;
$$;

create or replace function public.fn_hr_cancel_salary_sheet(p_sheet_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.hr_salary_sheets;
begin
  select * into s from public.hr_salary_sheets where id = p_sheet_id for update;
  if s.id is null then
    raise exception 'Salary sheet not found.';
  end if;
  if s.status = 'Draft' then
    if not public.fn_hr_can_prepare_salary() then
      raise exception 'Only the Owner, HR or Accounts can prepare salary.';
    end if;
  elsif not public.fn_hr_can_pay() then
    raise exception 'Only the Owner or Accounts can cancel a finalised salary sheet.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required.';
  end if;
  if s.status = 'Cancelled' then
    raise exception 'This salary sheet is already cancelled.';
  end if;
  if s.status = 'Paid' then
    raise exception 'This salary is already paid. Cancel the payment first.';
  end if;

  if s.status = 'Finalized' then
    if s.journal_entry_id is not null then
      perform public._fn_hr_reverse_entry(s.journal_entry_id, 'Salary ' || s.sheet_no || ' — cancelled', 'hr_salary_sheets', s.id);
    end if;
    delete from public.hr_advance_recoveries r using public.hr_salary_lines x
    where r.line_id = x.id and x.sheet_id = s.id;
    delete from public.hr_salary_days where sheet_id = s.id;
  end if;

  update public.hr_salary_sheets set status = 'Cancelled', cancel_reason = btrim(p_reason) where id = s.id;
end;
$$;

create or replace function public.fn_hr_pay_salary_sheet(
  p_sheet_id uuid,
  p_paid_on date,
  p_payment_source text,
  p_bank_account_id uuid,
  p_petty_cash_fund_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.hr_salary_sheets;
  v_code text;
  v_je uuid;
begin
  if not public.fn_hr_can_pay() then
    raise exception 'Only the Owner or Accounts can pay salary.';
  end if;
  select * into s from public.hr_salary_sheets where id = p_sheet_id for update;
  if s.id is null then
    raise exception 'Salary sheet not found.';
  end if;
  if s.status <> 'Finalized' then
    raise exception 'Only a finalised salary sheet can be marked paid.';
  end if;
  if p_paid_on is null then
    raise exception 'Payment date is required.';
  end if;
  if p_paid_on < s.period_from then
    raise exception 'Payment date cannot be before the salary period starts.';
  end if;
  if p_payment_source not in ('cash', 'bank', 'petty_cash') or p_payment_source is null then
    raise exception 'Choose how the salary was paid.';
  end if;
  if p_payment_source = 'bank' and (p_bank_account_id is null or not exists (select 1 from public.bank_accounts where id = p_bank_account_id)) then
    raise exception 'Please select a Bank Account.';
  end if;
  if p_payment_source = 'petty_cash' and (p_petty_cash_fund_id is null or not exists (select 1 from public.petty_cash_funds where id = p_petty_cash_fund_id)) then
    raise exception 'Please select a Petty Cash Fund.';
  end if;

  if s.journal_entry_id is not null and s.net_total > 0 then
    v_code := case p_payment_source when 'bank' then '1100' when 'petty_cash' then '1060' else '1050' end;
    v_je := public._fn_post_journal_entry_core(
      p_paid_on, 'Salary ' || s.sheet_no || ' paid', 'hr_salary_sheets', s.id,
      jsonb_build_array(
        jsonb_build_object('account_code', '2200', 'debit', s.net_total, 'credit', 0, 'memo', 'Salary paid'),
        jsonb_build_object('account_code', v_code, 'debit', 0, 'credit', s.net_total, 'memo', 'Salary paid',
          'bank_account_id', case when p_payment_source = 'bank' then p_bank_account_id end,
          'petty_cash_fund_id', case when p_payment_source = 'petty_cash' then p_petty_cash_fund_id end)));
  end if;

  update public.hr_salary_sheets
  set status = 'Paid', paid_on = p_paid_on, payment_source = p_payment_source,
      bank_account_id = case when p_payment_source = 'bank' then p_bank_account_id end,
      petty_cash_fund_id = case when p_payment_source = 'petty_cash' then p_petty_cash_fund_id end,
      payment_journal_entry_id = v_je
  where id = s.id;
end;
$$;

create or replace function public.fn_hr_cancel_salary_payment(p_sheet_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.hr_salary_sheets;
begin
  if not public.fn_hr_can_pay() then
    raise exception 'Only the Owner or Accounts can cancel a salary payment.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required.';
  end if;
  select * into s from public.hr_salary_sheets where id = p_sheet_id for update;
  if s.id is null or s.status <> 'Paid' then
    raise exception 'This salary sheet is not marked paid.';
  end if;
  if s.payment_journal_entry_id is not null then
    perform public._fn_hr_reverse_entry(s.payment_journal_entry_id, 'Salary ' || s.sheet_no || ' payment cancelled: ' || btrim(p_reason),
      'hr_salary_sheets', s.id);
  end if;
  update public.hr_salary_sheets
  set status = 'Finalized', paid_on = null, payment_source = null, bank_account_id = null,
      petty_cash_fund_id = null, payment_journal_entry_id = null
  where id = s.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Advances
-- ---------------------------------------------------------------------------
create or replace function public.fn_hr_create_advance(
  p_employee_id uuid,
  p_advance_date date,
  p_amount numeric,
  p_installment numeric,
  p_payment_source text,
  p_bank_account_id uuid,
  p_petty_cash_fund_id uuid,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp public.hr_employees;
  v_id uuid;
  v_no text;
  v_code text;
  v_je uuid;
begin
  if not public.fn_hr_can_pay() then
    raise exception 'Only the Owner or Accounts can give an advance.';
  end if;
  select * into v_emp from public.hr_employees where id = p_employee_id;
  if v_emp.id is null then
    raise exception 'Employee not found.';
  end if;
  if v_emp.status <> 'Active' then
    raise exception '% has left; an advance cannot be given.', v_emp.full_name;
  end if;
  if p_advance_date is null then
    raise exception 'Date is required.';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Amount must be more than 0.';
  end if;
  if coalesce(p_installment, 0) <= 0 or p_installment > p_amount then
    raise exception 'Recovery per salary must be more than 0 and not more than the advance.';
  end if;
  if p_payment_source not in ('cash', 'bank', 'petty_cash') or p_payment_source is null then
    raise exception 'Choose how the advance was paid.';
  end if;
  if p_payment_source = 'bank' and (p_bank_account_id is null or not exists (select 1 from public.bank_accounts where id = p_bank_account_id)) then
    raise exception 'Please select a Bank Account.';
  end if;
  if p_payment_source = 'petty_cash' and (p_petty_cash_fund_id is null or not exists (select 1 from public.petty_cash_funds where id = p_petty_cash_fund_id)) then
    raise exception 'Please select a Petty Cash Fund.';
  end if;

  v_no := public.fn_get_next_number('ADV');
  insert into public.hr_advances (advance_no, employee_id, advance_date, amount, installment, payment_source,
    bank_account_id, petty_cash_fund_id, note)
  values (v_no, p_employee_id, p_advance_date, round(p_amount, 2), round(p_installment, 2), p_payment_source,
    case when p_payment_source = 'bank' then p_bank_account_id end,
    case when p_payment_source = 'petty_cash' then p_petty_cash_fund_id end,
    nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  if (select salary_journal_enabled from public.hr_settings limit 1) then
    v_code := case p_payment_source when 'bank' then '1100' when 'petty_cash' then '1060' else '1050' end;
    v_je := public._fn_post_journal_entry_core(
      p_advance_date, 'Employee advance ' || v_no || ' — ' || v_emp.full_name, 'hr_advances', v_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '1150', 'debit', round(p_amount, 2), 'credit', 0, 'memo', 'Advance to ' || v_emp.full_name),
        jsonb_build_object('account_code', v_code, 'debit', 0, 'credit', round(p_amount, 2), 'memo', 'Advance paid',
          'bank_account_id', case when p_payment_source = 'bank' then p_bank_account_id end,
          'petty_cash_fund_id', case when p_payment_source = 'petty_cash' then p_petty_cash_fund_id end)));
    update public.hr_advances set journal_entry_id = v_je where id = v_id;
  end if;

  return v_id;
end;
$$;

create or replace function public.fn_hr_cancel_advance(p_advance_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.hr_advances;
begin
  if not public.fn_hr_can_pay() then
    raise exception 'Only the Owner or Accounts can cancel an advance.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required.';
  end if;
  select * into a from public.hr_advances where id = p_advance_id for update;
  if a.id is null then
    raise exception 'Advance not found.';
  end if;
  if a.status = 'Cancelled' then
    raise exception 'This advance is already cancelled.';
  end if;
  if exists (select 1 from public.hr_advance_recoveries where advance_id = a.id) then
    raise exception 'Part of this advance was already recovered from salary. Cancel that salary sheet first.';
  end if;
  if a.journal_entry_id is not null then
    perform public._fn_hr_reverse_entry(a.journal_entry_id, 'Employee advance ' || a.advance_no || ' — cancelled', 'hr_advances', a.id);
  end if;
  update public.hr_advances set status = 'Cancelled', cancel_reason = btrim(p_reason) where id = a.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Paid leave balance (for the employee page and reports)
-- ---------------------------------------------------------------------------
-- Quota is the yearly paid-leave allowance in force on 31 Dec of the year
-- (or today for the current year); used = paid-type leave taken on
-- working days while permanent, capped at the quota day by day.
create or replace function public.fn_hr_leave_balance(p_year int, p_employee_ids uuid[] default null)
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
  v_asof := least(make_date(p_year, 12, 31), greatest((now() at time zone 'Asia/Karachi')::date, make_date(p_year, 1, 1)));
  for e in
    select x.id, x.join_date, x.leave_date from public.hr_employees x
    where (p_employee_ids is null or x.id = any (p_employee_ids))
      and x.join_date <= make_date(p_year, 12, 31)
      and (x.leave_date is null or x.leave_date >= make_date(p_year, 1, 1))
  loop
    v_used := 0;
    v_extra := 0;
    for a in
      select w.work_date, w.leave_fraction, public._fn_hr_rules_on(e.id, w.work_date) as r
      from public.hr_attendance w
      join public.hr_leave_types lt on lt.id = w.leave_type_id and lt.is_paid
      where w.employee_id = e.id and w.mark = 'leave'
        and w.work_date between make_date(p_year, 1, 1) and make_date(p_year, 12, 31)
        and (public.fn_hr_terms_on(e.id, w.work_date)).employee_type = 'permanent'
      order by w.work_date
    loop
      continue when public._fn_hr_day_kind(a.r, a.work_date) <> 'work';
      v_q := (a.r ->> 'paid_leaves_per_year')::numeric;
      v_take := least(a.leave_fraction, greatest(v_q - v_used, 0));
      v_used := v_used + v_take;
      v_extra := v_extra + (a.leave_fraction - v_take);
    end loop;
    v_quota := coalesce((public._fn_hr_rules_on(e.id, greatest(least(v_asof, coalesce(e.leave_date, v_asof)), e.join_date)) ->> 'paid_leaves_per_year')::numeric, 0);
    employee_id := e.id;
    quota := v_quota;
    used := v_used;
    unpaid_extra := v_extra;
    remaining := greatest(v_quota - v_used, 0);
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public.fn_hr_can_pay() from public, anon;
revoke execute on function public.fn_hr_can_prepare_salary() from public, anon;
revoke execute on function public._fn_hr_paid_shift(jsonb) from public, anon, authenticated;
revoke execute on function public._fn_hr_month_working_days(uuid, date) from public, anon, authenticated;
revoke execute on function public._fn_hr_day_on_sheet(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public._fn_hr_advance_outstanding(uuid) from public, anon, authenticated;
revoke execute on function public._fn_hr_advance_due(uuid) from public, anon, authenticated;
revoke execute on function public._fn_hr_compute_line(uuid, text, text, date, date, uuid) from public, anon, authenticated;
revoke execute on function public._fn_hr_compute_sheet(uuid) from public, anon, authenticated;
revoke execute on function public._fn_hr_reverse_entry(uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.fn_hr_generate_salary_sheet(text, text, date, date, text) from public, anon;
revoke execute on function public.fn_hr_recalculate_salary_sheet(uuid) from public, anon;
revoke execute on function public.fn_hr_set_salary_adjustment(uuid, numeric, numeric, numeric, text) from public, anon;
revoke execute on function public.fn_hr_finalize_salary_sheet(uuid) from public, anon;
revoke execute on function public.fn_hr_cancel_salary_sheet(uuid, text) from public, anon;
revoke execute on function public.fn_hr_pay_salary_sheet(uuid, date, text, uuid, uuid) from public, anon;
revoke execute on function public.fn_hr_cancel_salary_payment(uuid, text) from public, anon;
revoke execute on function public.fn_hr_create_advance(uuid, date, numeric, numeric, text, uuid, uuid, text) from public, anon;
revoke execute on function public.fn_hr_cancel_advance(uuid, text) from public, anon;
revoke execute on function public.fn_hr_leave_balance(int, uuid[]) from public, anon;

grant execute on function public.fn_hr_can_pay() to authenticated;
grant execute on function public.fn_hr_can_prepare_salary() to authenticated;
grant execute on function public.fn_hr_generate_salary_sheet(text, text, date, date, text) to authenticated;
grant execute on function public.fn_hr_recalculate_salary_sheet(uuid) to authenticated;
grant execute on function public.fn_hr_set_salary_adjustment(uuid, numeric, numeric, numeric, text) to authenticated;
grant execute on function public.fn_hr_finalize_salary_sheet(uuid) to authenticated;
grant execute on function public.fn_hr_cancel_salary_sheet(uuid, text) to authenticated;
grant execute on function public.fn_hr_pay_salary_sheet(uuid, date, text, uuid, uuid) to authenticated;
grant execute on function public.fn_hr_cancel_salary_payment(uuid, text) to authenticated;
grant execute on function public.fn_hr_create_advance(uuid, date, numeric, numeric, text, uuid, uuid, text) to authenticated;
grant execute on function public.fn_hr_cancel_advance(uuid, text) to authenticated;
grant execute on function public.fn_hr_leave_balance(int, uuid[]) to authenticated;
