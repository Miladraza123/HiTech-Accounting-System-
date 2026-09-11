-- ============================================================
-- Phase 10 part A: retrofit Phase 9's five new tables with the standard
-- audit-trail + updated_at triggers every other table in this schema
-- already carries. Missed in Phase 9 — audit_log (the mechanism behind
-- prompt §35) works off a generic per-table trigger (fn_audit_row); these
-- financial tables never got it attached. Caught during Phase 10 planning.
-- ============================================================
alter table public.bank_accounts add column updated_at timestamptz not null default now();
alter table public.bank_accounts add column updated_by uuid references auth.users(id);
alter table public.petty_cash_funds add column updated_at timestamptz not null default now();
alter table public.petty_cash_funds add column updated_by uuid references auth.users(id);
alter table public.expense_heads add column updated_at timestamptz not null default now();
alter table public.expense_heads add column updated_by uuid references auth.users(id);
alter table public.expenses add column updated_at timestamptz not null default now();
alter table public.expenses add column updated_by uuid references auth.users(id);
alter table public.contra_transfers add column updated_at timestamptz not null default now();
alter table public.contra_transfers add column updated_by uuid references auth.users(id);

create trigger trg_audit after insert or delete or update on public.bank_accounts for each row execute function fn_audit_row();
create trigger trg_updated_at before update on public.bank_accounts for each row execute function fn_set_updated_at();
create trigger trg_audit after insert or delete or update on public.petty_cash_funds for each row execute function fn_audit_row();
create trigger trg_updated_at before update on public.petty_cash_funds for each row execute function fn_set_updated_at();
create trigger trg_audit after insert or delete or update on public.expense_heads for each row execute function fn_audit_row();
create trigger trg_updated_at before update on public.expense_heads for each row execute function fn_set_updated_at();
create trigger trg_audit after insert or delete or update on public.expenses for each row execute function fn_audit_row();
create trigger trg_updated_at before update on public.expenses for each row execute function fn_set_updated_at();
create trigger trg_audit after insert or delete or update on public.contra_transfers for each row execute function fn_audit_row();
create trigger trg_updated_at before update on public.contra_transfers for each row execute function fn_set_updated_at();

-- ============================================================
-- Phase 10 part B: Vehicle / Fleet Management (prompt §20) + Engineer/Rider
-- field expense tracking (§21) — built as an extension of Phase 9's Expense
-- module rather than a parallel system: a vehicle-linked expense is still
-- just an Expense with a vehicle_id, exactly like a job-linked expense
-- already was. Purchase/GRN-style separate module was NOT needed here.
-- ============================================================
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  vehicle_no text not null unique,
  registration_no text,
  vehicle_type text,
  make_model text,
  assigned_user_id uuid references public.profiles(id),
  assignment_date date,
  opening_meter_reading numeric(12,2) not null default 0,
  current_meter_reading numeric(12,2) not null default 0,
  status text not null default 'Active' check (status in ('Active','UnderMaintenance','Retired','Unassigned')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  check (current_meter_reading >= opening_meter_reading)
);

comment on table public.vehicles is 'Company fleet (cars/bikes) assigned to Engineers/Riders. Expenses reference vehicles.id directly — no separate fuel-log table.';

create trigger trg_audit after insert or delete or update on public.vehicles for each row execute function fn_audit_row();
create trigger trg_updated_at before update on public.vehicles for each row execute function fn_set_updated_at();

alter table public.vehicles enable row level security;
create policy p_select on public.vehicles for select using (true);
create policy p_insert on public.vehicles for insert with check (public.is_owner() or public.has_role('accounts'));
create policy p_update on public.vehicles for update using (public.is_owner() or public.has_role('accounts')) with check (public.is_owner() or public.has_role('accounts'));

-- Vehicle-linked expense fields, plus a lightweight Settlement Status
-- tracking flag for field-issued expenses (prompt §21). Deliberately just a
-- tracking flag, not a separate unsettled-advance sub-ledger — the expense
-- still posts its real cash/bank/petty-cash movement immediately at entry,
-- same as every other expense; "Pending" just flags it for follow-up.
alter table public.expenses add column vehicle_id uuid references public.vehicles(id);
alter table public.expenses add column odometer_reading numeric(12,2);
alter table public.expenses add column fuel_litres numeric(10,2);
alter table public.expenses add column fuel_rate numeric(10,2);
alter table public.expenses add column settlement_status text not null default 'Settled' check (settlement_status in ('Settled','Pending'));

create index idx_expenses_vehicle on public.expenses(vehicle_id);

-- Additional vehicle-specific Expense Heads from the prompt's own list
-- (Fuel, Repair, Maintenance, Miscellaneous already exist from Phase 9).
insert into public.chart_of_accounts (code, name, account_type, parent_id, is_system)
select code, name, 'expense', (select id from public.chart_of_accounts where code = '6000'), false
from (values
  ('6011','Oil Change Expense'), ('6012','Tyres Expense'), ('6013','Battery Expense'),
  ('6014','Insurance Expense'), ('6015','Token/Registration Expense'), ('6016','Toll Expense'),
  ('6017','Parking Expense'), ('6018','Fine/Challan Expense'), ('6019','Tracker Expense'),
  ('6020','Accident Expense')
) as t(code, name);

insert into public.expense_heads (code, name, account_code) values
  ('OIL_CHANGE','Oil Change','6011'), ('TYRES','Tyres','6012'), ('BATTERY','Battery','6013'),
  ('INSURANCE','Insurance','6014'), ('TOKEN_REG','Token/Registration','6015'), ('TOLL','Toll','6016'),
  ('PARKING','Parking','6017'), ('FINE_CHALLAN','Fine/Challan','6018'), ('TRACKER','Tracker','6019'),
  ('ACCIDENT','Accident Expense','6020');

-- fn_create_expense widened with vehicle/odometer/fuel/settlement fields.
-- CREATE OR REPLACE cannot change a signature (Phase 9 learned this the
-- hard way with fn_create_payment) — creating the new 15-arg version here
-- and explicitly dropping the old 10-arg one immediately after, within the
-- same migration/transaction, so no ambiguous overload is ever exposed.
create or replace function public.fn_create_expense(
  p_expense_date date, p_expense_head_id uuid, p_amount numeric, p_payment_source text,
  p_bank_account_id uuid, p_petty_cash_fund_id uuid, p_job_id uuid, p_responsible_user_id uuid,
  p_department text, p_description text,
  p_vehicle_id uuid default null, p_odometer_reading numeric default null,
  p_fuel_litres numeric default null, p_fuel_rate numeric default null,
  p_settlement_status text default 'Settled'
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_head record;
  v_expense_id uuid;
  v_expense_no text;
  v_credit_account_code text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Expense record kar sakte hain.';
  end if;
  if p_amount <= 0 then
    raise exception 'Amount zero se zyada hona chahiye.';
  end if;
  if p_payment_source not in ('cash', 'bank', 'petty_cash') then
    raise exception 'Payment source ghalat hai.';
  end if;
  if p_payment_source = 'bank' and p_bank_account_id is null then
    raise exception 'Bank Account select karen.';
  end if;
  if p_payment_source = 'petty_cash' and p_petty_cash_fund_id is null then
    raise exception 'Petty Cash Fund select karen.';
  end if;
  if coalesce(p_settlement_status, 'Settled') not in ('Settled','Pending') then
    raise exception 'Settlement status ghalat hai.';
  end if;

  select * into v_head from public.expense_heads where id = p_expense_head_id and is_active;
  if v_head.id is null then
    raise exception 'Expense Head nahi mila.';
  end if;

  v_credit_account_code := case p_payment_source when 'bank' then '1100' when 'petty_cash' then '1060' else '1050' end;

  select public.fn_get_next_number('EXP') into v_expense_no;

  insert into public.expenses
    (expense_no, expense_date, expense_head_id, amount, payment_source, bank_account_id, petty_cash_fund_id,
     job_id, responsible_user_id, department, description, vehicle_id, odometer_reading, fuel_litres, fuel_rate,
     settlement_status, created_by)
  values
    (v_expense_no, coalesce(p_expense_date, current_date), p_expense_head_id, p_amount, p_payment_source,
     case when p_payment_source = 'bank' then p_bank_account_id end,
     case when p_payment_source = 'petty_cash' then p_petty_cash_fund_id end,
     p_job_id, p_responsible_user_id, nullif(trim(p_department), ''), nullif(trim(p_description), ''),
     p_vehicle_id, p_odometer_reading, p_fuel_litres, p_fuel_rate, coalesce(p_settlement_status, 'Settled'), auth.uid())
  returning id into v_expense_id;

  -- Keep the vehicle's live meter reading in sync — only ever moves forward,
  -- never regresses (so a backdated/historical entry doesn't corrupt it).
  if p_vehicle_id is not null and p_odometer_reading is not null then
    update public.vehicles
      set current_meter_reading = p_odometer_reading
      where id = p_vehicle_id and p_odometer_reading > current_meter_reading;
  end if;

  perform public._fn_post_journal_entry_core(
    coalesce(p_expense_date, current_date), 'Expense ' || v_expense_no || ' — ' || v_head.name, 'expenses', v_expense_id,
    jsonb_build_array(
      jsonb_build_object('account_code', v_head.account_code, 'debit', p_amount, 'credit', 0, 'memo', v_head.name),
      jsonb_build_object(
        'account_code', v_credit_account_code,
        'bank_account_id', case when p_payment_source = 'bank' then p_bank_account_id end,
        'petty_cash_fund_id', case when p_payment_source = 'petty_cash' then p_petty_cash_fund_id end,
        'debit', 0, 'credit', p_amount, 'memo', 'Expense paid'
      )
    )
  );

  return v_expense_id;
end;
$function$;

drop function if exists public.fn_create_expense(date, uuid, numeric, text, uuid, uuid, uuid, uuid, text, text);

-- ---- Reporting views (security_invoker=true from the start) ----
create view public.vehicle_expense_summary with (security_invoker = true) as
select
  v.id as vehicle_id,
  v.vehicle_no,
  v.vehicle_type,
  v.make_model,
  v.status,
  v.assigned_user_id,
  v.opening_meter_reading,
  v.current_meter_reading,
  coalesce(sum(e.amount) filter (where e.status = 'Posted'), 0) as total_expense,
  coalesce(sum(e.amount) filter (where e.status = 'Posted' and e.expense_head_id in (select id from public.expense_heads where code = 'FUEL')), 0) as fuel_expense,
  coalesce(sum(e.amount) filter (where e.status = 'Posted' and e.expense_head_id in (select id from public.expense_heads where code in ('REPAIR', 'MAINTENANCE', 'OIL_CHANGE', 'TYRES', 'BATTERY'))), 0) as maintenance_expense
from public.vehicles v
left join public.expenses e on e.vehicle_id = v.id
group by v.id, v.vehicle_no, v.vehicle_type, v.make_model, v.status, v.assigned_user_id, v.opening_meter_reading, v.current_meter_reading;

create view public.responsible_person_expense_summary with (security_invoker = true) as
select
  p.id as user_id,
  p.full_name,
  coalesce(sum(e.amount) filter (where e.status = 'Posted'), 0) as total_expense,
  count(e.id) filter (where e.status = 'Posted') as expense_count,
  count(e.id) filter (where e.status = 'Posted' and e.settlement_status = 'Pending') as pending_settlement_count
from public.profiles p
left join public.expenses e on e.responsible_user_id = p.id
group by p.id, p.full_name;
