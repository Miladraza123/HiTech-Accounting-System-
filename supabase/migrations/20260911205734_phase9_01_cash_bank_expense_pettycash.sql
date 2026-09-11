-- ============================================================
-- Phase 9: Cash & Bank Management, Manual Journal Vouchers,
-- Contra Entries, Expense Management, Petty Cash.
-- ============================================================

-- ---- New chart-of-accounts rows ----
-- 1100 already exists as "Bank / Cash" (control account, was previously
-- doing double duty for both cash and bank). Splitting it: 1100 becomes
-- the Bank Accounts control (sub-ledger = bank_accounts, dimensioned by
-- journal_lines.bank_account_id, exactly like party_id already dimensions
-- 1200/2100), 1050 is a new plain Cash-in-Hand account, 1060 is a new
-- Petty Cash control (sub-ledger = petty_cash_funds, same dimensioning
-- pattern for multiple custodians). 6000 range used for expense heads
-- since 5900 is already taken (Inventory Adjustment, Phase 3).
update public.chart_of_accounts set name = 'Bank Accounts' where code = '1100';

insert into public.chart_of_accounts (code, name, account_type, is_system)
values
  ('1050', 'Cash in Hand', 'asset', true),
  ('1060', 'Petty Cash', 'asset', true),
  ('6000', 'Operating Expenses', 'expense', true);

insert into public.chart_of_accounts (code, name, account_type, parent_id, is_system)
select code, name, 'expense', (select id from public.chart_of_accounts where code = '6000'), false
from (values
  ('6001','Fuel Expense'), ('6002','Transport Expense'), ('6003','Loading Expense'),
  ('6004','Office Expense'), ('6005','Site Expense'), ('6006','Repair Expense'),
  ('6007','Maintenance Expense'), ('6008','Salary Expense'), ('6009','Utility Expense'),
  ('6010','Miscellaneous Expense')
) as t(code, name);

-- ---- New numbering series ----
insert into public.numbering_sequences (doc_type, label, prefix, fy_reset, padding, current_value)
values
  ('EXP', 'Expense', 'EXP-', true, 4, 0),
  ('CT', 'Contra / Fund Transfer', 'CT-', true, 4, 0);

-- ---- New master tables ----
create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  account_name text not null,
  bank_name text,
  account_number text,
  branch text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table public.petty_cash_funds (
  id uuid primary key default gen_random_uuid(),
  fund_name text not null,
  custodian_user_id uuid references public.profiles(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table public.expense_heads (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  account_code text not null references public.chart_of_accounts(code),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

insert into public.expense_heads (code, name, account_code) values
  ('FUEL','Fuel','6001'), ('TRANSPORT','Transport','6002'), ('LOADING','Loading','6003'),
  ('OFFICE','Office Expense','6004'), ('SITE','Site Expense','6005'), ('REPAIR','Repair','6006'),
  ('MAINTENANCE','Maintenance','6007'), ('SALARY','Salary','6008'), ('UTILITY','Utility','6009'),
  ('MISC','Miscellaneous Expense','6010');

-- ---- New transaction tables ----
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_no text not null unique,
  expense_date date not null default current_date,
  expense_head_id uuid not null references public.expense_heads(id),
  amount numeric(18,2) not null check (amount > 0),
  payment_source text not null check (payment_source in ('cash','bank','petty_cash')),
  bank_account_id uuid references public.bank_accounts(id),
  petty_cash_fund_id uuid references public.petty_cash_funds(id),
  job_id uuid references public.jobs(id),
  responsible_user_id uuid references public.profiles(id),
  department text,
  description text,
  status text not null default 'Posted' check (status in ('Posted','Cancelled')),
  cancel_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  check (payment_source <> 'bank' or bank_account_id is not null),
  check (payment_source <> 'petty_cash' or petty_cash_fund_id is not null)
);

create table public.contra_transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_no text not null unique,
  transfer_date date not null default current_date,
  from_type text not null check (from_type in ('cash','bank','petty_cash')),
  from_bank_account_id uuid references public.bank_accounts(id),
  from_petty_cash_fund_id uuid references public.petty_cash_funds(id),
  to_type text not null check (to_type in ('cash','bank','petty_cash')),
  to_bank_account_id uuid references public.bank_accounts(id),
  to_petty_cash_fund_id uuid references public.petty_cash_funds(id),
  amount numeric(18,2) not null check (amount > 0),
  notes text,
  journal_entry_id uuid references public.journal_entries(id),
  status text not null default 'Posted' check (status in ('Posted','Cancelled')),
  cancel_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- ---- journal_lines / payments dimension columns (mirrors the existing party_id pattern) ----
alter table public.journal_lines add column bank_account_id uuid references public.bank_accounts(id);
alter table public.journal_lines add column petty_cash_fund_id uuid references public.petty_cash_funds(id);
alter table public.payments add column bank_account_id uuid references public.bank_accounts(id);
alter table public.payments add column petty_cash_fund_id uuid references public.petty_cash_funds(id);

create index idx_journal_lines_bank_account on public.journal_lines(bank_account_id);
create index idx_journal_lines_petty_cash_fund on public.journal_lines(petty_cash_fund_id);

-- ---- RLS ----
alter table public.bank_accounts enable row level security;
create policy p_select on public.bank_accounts for select using (true);
create policy p_insert on public.bank_accounts for insert with check (public.is_owner() or public.has_role('accounts'));
create policy p_update on public.bank_accounts for update using (public.is_owner() or public.has_role('accounts')) with check (public.is_owner() or public.has_role('accounts'));

alter table public.petty_cash_funds enable row level security;
create policy p_select on public.petty_cash_funds for select using (true);
create policy p_insert on public.petty_cash_funds for insert with check (public.is_owner() or public.has_role('accounts'));
create policy p_update on public.petty_cash_funds for update using (public.is_owner() or public.has_role('accounts')) with check (public.is_owner() or public.has_role('accounts'));

alter table public.expense_heads enable row level security;
create policy p_select on public.expense_heads for select using (true);
create policy p_insert on public.expense_heads for insert with check (public.is_owner());
create policy p_update on public.expense_heads for update using (public.is_owner()) with check (public.is_owner());

alter table public.expenses enable row level security;
create policy p_select on public.expenses for select using (true);
create policy p_insert on public.expenses for insert with check (public.is_owner() or public.has_role('accounts'));
create policy p_update on public.expenses for update using (public.is_owner() or public.has_role('accounts')) with check (public.is_owner() or public.has_role('accounts'));

alter table public.contra_transfers enable row level security;
create policy p_select on public.contra_transfers for select using (true);
create policy p_insert on public.contra_transfers for insert with check (public.is_owner() or public.has_role('accounts'));
create policy p_update on public.contra_transfers for update using (public.is_owner() or public.has_role('accounts')) with check (public.is_owner() or public.has_role('accounts'));

-- ---- Core posting engine: add bank_account_id/petty_cash_fund_id dimension
-- support (mirrors party_id) + a hard debit=credit balance check. The check is
-- new: every existing caller already constructs mathematically-balanced lines,
-- so this only guards against a genuinely unbalanced entry (which becomes a
-- real risk once manual Journal Vouchers are exposed to a human via UI).
create or replace function public._fn_post_journal_entry_core(p_entry_date date, p_narration text, p_source_table text, p_source_id uuid, p_lines jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_entry_id uuid;
  v_entry_no text;
  v_line jsonb;
  v_account_id uuid;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
begin
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_total_debit := v_total_debit + coalesce((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + coalesce((v_line->>'credit')::numeric, 0);
  end loop;
  if round(v_total_debit - v_total_credit, 2) <> 0 then
    raise exception 'Journal entry balanced nahi hai (Debit: %, Credit: %).', v_total_debit, v_total_credit;
  end if;

  select public.fn_get_next_number('JV') into v_entry_no;

  insert into public.journal_entries (entry_no, entry_date, narration, source_table, source_id, created_by)
  values (v_entry_no, p_entry_date, p_narration, p_source_table, p_source_id, auth.uid())
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select id into v_account_id from public.chart_of_accounts where code = v_line->>'account_code';
    if v_account_id is null then
      raise exception 'Unknown chart of accounts code: %', v_line->>'account_code';
    end if;
    insert into public.journal_lines (journal_entry_id, account_id, party_id, bank_account_id, petty_cash_fund_id, debit, credit, memo)
    values (
      v_entry_id,
      v_account_id,
      nullif(v_line->>'party_id','')::uuid,
      nullif(v_line->>'bank_account_id','')::uuid,
      nullif(v_line->>'petty_cash_fund_id','')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      v_line->>'memo'
    );
  end loop;

  return v_entry_id;
end;
$function$;

revoke all on function public._fn_post_journal_entry_core(date, text, text, uuid, jsonb) from anon, public;
