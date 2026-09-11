create table public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  account_type text not null check (account_type in ('asset','liability','equity','income','expense')),
  parent_id uuid references public.chart_of_accounts(id),
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_no text not null unique,
  entry_date date not null default current_date,
  source_table text,
  source_id uuid,
  narration text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_id uuid not null references public.chart_of_accounts(id),
  party_id uuid references public.parties(id),
  debit numeric(18,2) not null default 0,
  credit numeric(18,2) not null default 0,
  memo text,
  check (debit >= 0 and credit >= 0 and (debit = 0 or credit = 0))
);

create index idx_journal_lines_entry on public.journal_lines(journal_entry_id);
create index idx_journal_lines_account on public.journal_lines(account_id);
create index idx_journal_lines_party on public.journal_lines(party_id);

-- Every journal entry must always balance (Dr = Cr). Deferred so a
-- multi-line INSERT within one transaction only gets checked at commit.
create or replace function public.fn_check_journal_balance()
returns trigger
language plpgsql
as $$
declare
  v_je_id uuid;
  v_sum_debit numeric;
  v_sum_credit numeric;
begin
  v_je_id := coalesce(new.journal_entry_id, old.journal_entry_id);
  select coalesce(sum(debit),0), coalesce(sum(credit),0)
    into v_sum_debit, v_sum_credit
    from public.journal_lines where journal_entry_id = v_je_id;
  if v_sum_debit <> v_sum_credit then
    raise exception 'Journal entry % is not balanced: total debit=% total credit=%', v_je_id, v_sum_debit, v_sum_credit;
  end if;
  return null;
end;
$$;

create constraint trigger trg_journal_balance
after insert or update or delete on public.journal_lines
deferrable initially deferred
for each row execute function public.fn_check_journal_balance();

-- Post a manual/opening-balance journal entry. SECURITY DEFINER so it is the
-- only way to write into journal_entries/journal_lines — no direct table
-- grants are given to app roles (see RLS migration).
create or replace function public.fn_post_journal_entry(
  p_entry_date date,
  p_narration text,
  p_source_table text,
  p_source_id uuid,
  p_lines jsonb -- [{account_code, party_id, debit, credit, memo}, ...]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_entry_no text;
  v_line jsonb;
  v_account_id uuid;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts may post journal entries.';
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
    insert into public.journal_lines (journal_entry_id, account_id, party_id, debit, credit, memo)
    values (
      v_entry_id,
      v_account_id,
      nullif(v_line->>'party_id','')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      v_line->>'memo'
    );
  end loop;

  return v_entry_id;
end;
$$;
