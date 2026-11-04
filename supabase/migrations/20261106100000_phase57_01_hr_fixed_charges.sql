-- Phase 57.01: HR — fixed monthly charges deducted from salary (lunch, uniform, ...).
--
-- Each employee can carry any number of fixed charges (name + amount). When a
-- salary sheet is generated, the employee's active charges are COPIED onto
-- the salary line, so the sheet keeps its own figures:
--   * a later change to the set amount never alters a sheet that already exists;
--   * on a Draft sheet the amounts can be edited per line (a note is required
--     when a set amount is changed), without touching the set amount.
--
--   gross = base + overtime + bonus − late − early − sandwich − other cuts − fixed charges
--   net   = gross − advance recovered
--
-- Fixed charges are folded into gross, exactly like "other cuts", so the
-- sheet totals, the negative-pay check at finalise and the salary journal
-- (expense = gross total) all see them with no change: the salary expense
-- shows the reduced amount. Nothing existing is altered: old lines get
-- fixed_charges_total = 0 and are flagged as "charges already handled", so
-- a recalculation of an existing draft never adds charges on its own (use
-- "Load fixed charges" on the sheet for that).

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.hr_fixed_charges (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  name text not null check (btrim(name) <> '' and char_length(name) <= 60),
  amount numeric(14,2) not null check (amount > 0),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists hr_fixed_charges_emp_name_uq on public.hr_fixed_charges (employee_id, lower(btrim(name)));

create table if not exists public.hr_salary_line_charges (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.hr_salary_lines(id) on delete cascade,
  name text not null check (btrim(name) <> '' and char_length(name) <= 60),
  amount numeric(14,2) not null check (amount >= 0),
  source_amount numeric(14,2),   -- the set amount when it was copied (null: added on the sheet)
  note text,
  created_at timestamptz not null default now()
);
create index if not exists hr_salary_line_charges_line_idx on public.hr_salary_line_charges (line_id);

-- Existing lines: already handled (no charges), so recalculation leaves them alone.
alter table public.hr_salary_lines add column if not exists fixed_charges_total numeric(14,2) not null default 0 check (fixed_charges_total >= 0);
alter table public.hr_salary_lines add column if not exists charges_loaded boolean not null default true;
alter table public.hr_salary_lines alter column charges_loaded set default false;

drop trigger if exists trg_updated_at on public.hr_fixed_charges;
create trigger trg_updated_at before update on public.hr_fixed_charges for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_audit on public.hr_fixed_charges;
create trigger trg_audit after insert or update or delete on public.hr_fixed_charges for each row execute function public.fn_audit_row();
drop trigger if exists trg_audit on public.hr_salary_line_charges;
create trigger trg_audit after insert or update or delete on public.hr_salary_line_charges for each row execute function public.fn_audit_row();

alter table public.hr_fixed_charges enable row level security;
alter table public.hr_salary_line_charges enable row level security;
drop policy if exists p_select on public.hr_fixed_charges;
drop policy if exists p_select on public.hr_salary_line_charges;
create policy p_select on public.hr_fixed_charges for select to authenticated using (public.fn_hr_can_read());
create policy p_select on public.hr_salary_line_charges for select to authenticated using (public.fn_hr_can_read());
revoke all on public.hr_fixed_charges, public.hr_salary_line_charges from anon, authenticated;
grant select on public.hr_fixed_charges, public.hr_salary_line_charges to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Set amounts (per employee, and one charge for many employees)
-- ---------------------------------------------------------------------------
-- p_charges: [{id?, name, amount, is_active?}]. Rows of the employee not listed are removed
-- (salary sheets keep their own copies, so removing never changes a sheet).
create or replace function public.fn_hr_set_fixed_charges(p_employee_id uuid, p_charges jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c jsonb;
  v_id uuid;
  v_name text;
  v_amount numeric;
  v_keep uuid[] := '{}';
begin
  if not public.fn_hr_can_prepare_salary() then
    raise exception 'Only the Owner, HR or Accounts can set fixed charges.';
  end if;
  if not exists (select 1 from public.hr_employees where id = p_employee_id) then
    raise exception 'Employee not found.';
  end if;
  if p_charges is null or jsonb_typeof(p_charges) <> 'array' then
    raise exception 'Fixed charges must be a list.';
  end if;

  for c in select * from jsonb_array_elements(p_charges) loop
    v_name := btrim(coalesce(c ->> 'name', ''));
    if v_name = '' then
      raise exception 'Every fixed charge needs a name.';
    end if;
    if char_length(v_name) > 60 then
      raise exception 'Charge name "%" is too long (60 characters at most).', v_name;
    end if;
    begin
      v_amount := round((c ->> 'amount')::numeric, 2);
    exception when others then
      raise exception 'Enter a valid amount for "%".', v_name;
    end;
    if v_amount is null or v_amount <= 0 then
      raise exception 'The amount of "%" must be more than zero.', v_name;
    end if;
    v_id := nullif(c ->> 'id', '')::uuid;

    if v_id is not null and exists (select 1 from public.hr_fixed_charges where id = v_id and employee_id = p_employee_id) then
      update public.hr_fixed_charges
      set name = v_name, amount = v_amount, is_active = coalesce((c ->> 'is_active')::boolean, true)
      where id = v_id;
    else
      insert into public.hr_fixed_charges (employee_id, name, amount, is_active)
      values (p_employee_id, v_name, v_amount, coalesce((c ->> 'is_active')::boolean, true))
      returning id into v_id;
    end if;
    if v_id = any (v_keep) then
      raise exception 'The charge "%" is listed twice.', v_name;
    end if;
    v_keep := v_keep || v_id;
  end loop;

  delete from public.hr_fixed_charges where employee_id = p_employee_id and not (id = any (v_keep));
end;
$fn$;

-- One charge (e.g. Lunch) for several employees at once: adds it, or updates the amount when
-- the employee already has a charge of that name.
create or replace function public.fn_hr_apply_fixed_charge(p_name text, p_amount numeric, p_employee_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_count int := 0;
  v_emp uuid;
begin
  if not public.fn_hr_can_prepare_salary() then
    raise exception 'Only the Owner, HR or Accounts can set fixed charges.';
  end if;
  if v_name = '' or char_length(v_name) > 60 then
    raise exception 'Enter a charge name (60 characters at most).';
  end if;
  if v_amount <= 0 then
    raise exception 'The amount must be more than zero.';
  end if;
  if p_employee_ids is null or coalesce(array_length(p_employee_ids, 1), 0) = 0 then
    raise exception 'Choose at least one employee.';
  end if;
  foreach v_emp in array p_employee_ids loop
    if not exists (select 1 from public.hr_employees where id = v_emp) then
      continue;
    end if;
    insert into public.hr_fixed_charges (employee_id, name, amount, is_active)
    values (v_emp, v_name, v_amount, true)
    on conflict (employee_id, (lower(btrim(name)))) do update set amount = excluded.amount, is_active = true;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Salary line: totals from its charges
-- ---------------------------------------------------------------------------
-- Recomputes charges total, gross and net of one line from its parts, then the sheet totals.
create or replace function public._fn_hr_refresh_line_totals(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  l public.hr_salary_lines;
  v_charges numeric;
  v_gross numeric;
begin
  select * into l from public.hr_salary_lines where id = p_line_id for update;
  if l.id is null then
    return;
  end if;
  select coalesce(sum(amount), 0) into v_charges from public.hr_salary_line_charges where line_id = l.id;
  v_gross := l.base_pay + l.ot_pay + l.bonus - l.late_deduction - l.early_deduction - l.sandwich_deduction
           - l.other_deduction - v_charges;
  update public.hr_salary_lines
  set fixed_charges_total = round(v_charges, 2),
      gross = round(v_gross, 2),
      net = round(v_gross - l.advance_recovery, 2)
  where id = l.id;
  update public.hr_salary_sheets
  set gross_total = coalesce((select sum(gross) from public.hr_salary_lines where sheet_id = l.sheet_id), 0),
      advance_total = coalesce((select sum(advance_recovery) from public.hr_salary_lines where sheet_id = l.sheet_id), 0),
      net_total = coalesce((select sum(net) from public.hr_salary_lines where sheet_id = l.sheet_id), 0)
  where id = l.sheet_id;
end;
$fn$;

-- Copies the employee's ACTIVE set charges onto a line (replacing what the line holds).
create or replace function public._fn_hr_copy_charges_to_line(p_line_id uuid, p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  delete from public.hr_salary_line_charges where line_id = p_line_id;
  insert into public.hr_salary_line_charges (line_id, name, amount, source_amount)
  select p_line_id, c.name, c.amount, c.amount
  from public.hr_fixed_charges c
  where c.employee_id = p_employee_id and c.is_active
  order by c.created_at, c.name;
  update public.hr_salary_lines set charges_loaded = true where id = p_line_id;
end;
$fn$;

-- "Load fixed charges": pulls the set charges again onto one line (p_line_id) or every line of the
-- Draft sheet (p_line_id null). Replaces what those lines hold, edits included.
create or replace function public.fn_hr_reload_line_charges(p_sheet_id uuid, p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_status text;
  x record;
begin
  if not public.fn_hr_can_prepare_salary() then
    raise exception 'Only the Owner, HR or Accounts can prepare salary.';
  end if;
  select status into v_status from public.hr_salary_sheets where id = p_sheet_id for update;
  if v_status is null then
    raise exception 'Salary sheet not found.';
  end if;
  if v_status <> 'Draft' then
    raise exception 'Only a draft salary sheet can be changed.';
  end if;
  for x in select id, employee_id from public.hr_salary_lines
           where sheet_id = p_sheet_id and (p_line_id is null or id = p_line_id) loop
    perform public._fn_hr_copy_charges_to_line(x.id, x.employee_id);
    perform public._fn_hr_refresh_line_totals(x.id);
  end loop;
  -- advance recovery may no longer fit inside the (lower) gross
  update public.hr_salary_lines
  set advance_recovery = greatest(gross, 0), net = gross - greatest(gross, 0)
  where sheet_id = p_sheet_id and advance_recovery > greatest(gross, 0);
  update public.hr_salary_sheets
  set gross_total = coalesce((select sum(gross) from public.hr_salary_lines where sheet_id = p_sheet_id), 0),
      advance_total = coalesce((select sum(advance_recovery) from public.hr_salary_lines where sheet_id = p_sheet_id), 0),
      net_total = coalesce((select sum(net) from public.hr_salary_lines where sheet_id = p_sheet_id), 0)
  where id = p_sheet_id;
end;
$fn$;

-- Edit the charges of one line of a Draft sheet. p_charges: [{id?, name, amount, note?}].
-- Listed rows with an id keep their name and set amount; a note is required when the amount of
-- a set charge differs from its set amount. Rows not listed are removed from this line only.
create or replace function public.fn_hr_set_line_charges(p_line_id uuid, p_charges jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  l public.hr_salary_lines;
  v_status text;
  c jsonb;
  v_id uuid;
  v_row public.hr_salary_line_charges;
  v_name text;
  v_amount numeric;
  v_note text;
  v_keep uuid[] := '{}';
  v_charges numeric := 0;
  v_gross numeric;
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
  if p_charges is null or jsonb_typeof(p_charges) <> 'array' then
    raise exception 'Fixed charges must be a list.';
  end if;

  for c in select * from jsonb_array_elements(p_charges) loop
    begin
      v_amount := round((c ->> 'amount')::numeric, 2);
    exception when others then
      raise exception 'Enter a valid amount for "%".', coalesce(c ->> 'name', '');
    end;
    if v_amount is null or v_amount < 0 then
      raise exception 'A charge amount cannot be negative.';
    end if;
    v_note := nullif(btrim(coalesce(c ->> 'note', '')), '');
    v_id := nullif(c ->> 'id', '')::uuid;
    v_row := null;
    if v_id is not null then
      select * into v_row from public.hr_salary_line_charges where id = v_id and line_id = l.id;
    end if;

    if v_row.id is not null then
      if v_row.source_amount is not null and v_amount <> v_row.source_amount and v_note is null then
        raise exception 'Write a note for the changed amount of "%".', v_row.name;
      end if;
      update public.hr_salary_line_charges set amount = v_amount, note = v_note where id = v_row.id;
      v_keep := v_keep || v_row.id;
    else
      v_name := btrim(coalesce(c ->> 'name', ''));
      if v_name = '' or char_length(v_name) > 60 then
        raise exception 'Every charge needs a name (60 characters at most).';
      end if;
      insert into public.hr_salary_line_charges (line_id, name, amount, source_amount, note)
      values (l.id, v_name, v_amount, null, v_note)
      returning id into v_id;
      v_keep := v_keep || v_id;
    end if;
    v_charges := v_charges + v_amount;
  end loop;

  delete from public.hr_salary_line_charges where line_id = l.id and not (id = any (v_keep));
  update public.hr_salary_lines set charges_loaded = true where id = l.id;

  v_gross := l.base_pay + l.ot_pay + l.bonus - l.late_deduction - l.early_deduction - l.sandwich_deduction
           - l.other_deduction - v_charges;
  if l.advance_recovery > greatest(v_gross, 0) then
    raise exception 'The advance recovery (%) is more than the gross pay after these charges (%). Lower the advance recovery first.',
      l.advance_recovery, round(v_gross, 2);
  end if;
  perform public._fn_hr_refresh_line_totals(l.id);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Existing salary functions: fixed charges join the gross
-- ---------------------------------------------------------------------------
create or replace function public._fn_hr_compute_sheet(p_sheet_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  s public.hr_salary_sheets;
  e record;
  v_line jsonb;
  v_old public.hr_salary_lines;
  v_gross numeric;
  v_rec numeric;
  v_charges numeric;
  v_line_id uuid;
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

    -- New line: the set charges are copied after the insert. Existing line: its own charges stay.
    if v_old.id is null then
      select coalesce(sum(amount), 0) into v_charges from public.hr_fixed_charges where employee_id = e.id and is_active;
    else
      v_charges := coalesce(v_old.fixed_charges_total, 0);
    end if;

    v_gross := (v_line ->> 'base_pay')::numeric + (v_line ->> 'ot_pay')::numeric + coalesce(v_old.bonus, 0)
             - (v_line ->> 'late_deduction')::numeric - (v_line ->> 'early_deduction')::numeric
             - (v_line ->> 'sandwich_deduction')::numeric - coalesce(v_old.other_deduction, 0) - v_charges;
    v_rec := case when v_old.id is null then public._fn_hr_advance_due(e.id) else v_old.advance_recovery end;
    v_rec := greatest(least(v_rec, public._fn_hr_advance_outstanding(e.id), greatest(v_gross, 0)), 0);

    insert into public.hr_salary_lines (
      sheet_id, employee_id, employee_type, pay_basis, rate, days_count, working_days, present_days, absent_days,
      paid_leave_days, unpaid_leave_days, late_count, ot_minutes, sandwich_days, base_pay, ot_pay,
      late_deduction, early_deduction, sandwich_deduction, bonus, other_deduction, adjustment_note,
      fixed_charges_total, charges_loaded, gross, advance_recovery, net, days)
    values (
      s.id, e.id, v_line ->> 'employee_type', v_line ->> 'pay_basis', (v_line ->> 'rate')::numeric,
      (v_line ->> 'days_count')::int, (v_line ->> 'working_days')::numeric, (v_line ->> 'present_days')::numeric,
      (v_line ->> 'absent_days')::numeric, (v_line ->> 'paid_leave_days')::numeric, (v_line ->> 'unpaid_leave_days')::numeric,
      (v_line ->> 'late_count')::int, (v_line ->> 'ot_minutes')::int, (v_line ->> 'sandwich_days')::int,
      (v_line ->> 'base_pay')::numeric, (v_line ->> 'ot_pay')::numeric, (v_line ->> 'late_deduction')::numeric,
      (v_line ->> 'early_deduction')::numeric, (v_line ->> 'sandwich_deduction')::numeric,
      coalesce(v_old.bonus, 0), coalesce(v_old.other_deduction, 0), v_old.adjustment_note,
      round(v_charges, 2), true,
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

    if v_old.id is null then
      select id into v_line_id from public.hr_salary_lines where sheet_id = s.id and employee_id = e.id;
      perform public._fn_hr_copy_charges_to_line(v_line_id, e.id);
    end if;
  end loop;

  delete from public.hr_salary_lines where sheet_id = s.id and not (employee_id = any (v_ids));

  update public.hr_salary_sheets
  set gross_total = coalesce((select sum(gross) from public.hr_salary_lines where sheet_id = s.id), 0),
      advance_total = coalesce((select sum(advance_recovery) from public.hr_salary_lines where sheet_id = s.id), 0),
      net_total = coalesce((select sum(net) from public.hr_salary_lines where sheet_id = s.id), 0)
  where id = s.id;
end;
$fn$;

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
as $fn$
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
           - l.sandwich_deduction - round(coalesce(p_other_deduction, 0), 2) - l.fixed_charges_total;
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
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Permissions on the new functions
-- ---------------------------------------------------------------------------
revoke all on function public.fn_hr_set_fixed_charges(uuid, jsonb) from public, anon;
grant execute on function public.fn_hr_set_fixed_charges(uuid, jsonb) to authenticated;
revoke all on function public.fn_hr_apply_fixed_charge(text, numeric, uuid[]) from public, anon;
grant execute on function public.fn_hr_apply_fixed_charge(text, numeric, uuid[]) to authenticated;
revoke all on function public.fn_hr_reload_line_charges(uuid, uuid) from public, anon;
grant execute on function public.fn_hr_reload_line_charges(uuid, uuid) to authenticated;
revoke all on function public.fn_hr_set_line_charges(uuid, jsonb) from public, anon;
grant execute on function public.fn_hr_set_line_charges(uuid, jsonb) to authenticated;
revoke all on function public._fn_hr_refresh_line_totals(uuid) from public, anon, authenticated;
revoke all on function public._fn_hr_copy_charges_to_line(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Backup / restore: the two new tables must be restorable
-- ---------------------------------------------------------------------------
do $patch$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public._fn_restore_pk_columns(text)'::regprocedure) into v_def;
  if v_def like '%hr_fixed_charges%' and v_def like '%hr_salary_line_charges%' then
    return;
  end if;
  v_new := v_def;
  if v_new not like '%hr_fixed_charges%' then
    v_new := replace(v_new, 'else null', E'when ''hr_fixed_charges'' then array[''id'']\n    else null');
  end if;
  if v_new not like '%hr_salary_line_charges%' then
    v_new := replace(v_new, 'else null', E'when ''hr_salary_line_charges'' then array[''id'']\n    else null');
  end if;
  if v_new = v_def then
    raise exception '_fn_restore_pk_columns patch did not apply';
  end if;
  execute v_new;
end
$patch$;
