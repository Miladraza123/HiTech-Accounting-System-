-- Phase 31.03 — Report performance, part 2: cash opening balance + ledgers
--
-- All three functions are `security invoker`: they must go through exactly
-- the same RLS as the .select() calls they replace. Query shape only, never
-- a permission change.

-- /reports/cash-flow computed its opening balances by fetching EVERY journal
-- entry dated before the period start, with all lines, and summing the three
-- cash accounts in JavaScript. That set is the company's entire history and
-- grows forever — the one query in the app guaranteed to get slower every
-- single day. The period itself stays a normal ranged query (the user picks
-- the range); only this unbounded part moves into the database.
create or replace function public.fn_cash_opening_balances(p_before date)
returns table (code text, opening numeric)
language sql
security invoker
stable
as $$
  select coa.code,
         coalesce(sum(jl.debit - jl.credit), 0) as opening
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  join public.chart_of_accounts coa on coa.id = jl.account_id
  where je.entry_date < p_before
    and coa.code in ('1050', '1100', '1060')
  group by coa.code;
$$;

grant execute on function public.fn_cash_opening_balances(date) to authenticated;

-- /reports/general-ledger fetched every journal line ever posted to the
-- selected account and computed the running balance in JS. The running
-- balance genuinely needs every prior row, so it is computed here with a
-- window function and only the requested page is returned — the scan stays
-- in the database (indexed on account_id) instead of crossing the network.
--
-- Ordering is (entry_date, id). The old code sorted on entry_date alone, so
-- same-date rows came back in whatever order PostgREST happened to return —
-- unstable between loads. Adding id as a tiebreaker makes the running
-- balance deterministic; the totals are unchanged either way.
create or replace function public.fn_account_ledger(p_account_id uuid, p_limit int, p_offset int)
returns table (
  entry_date date,
  narration text,
  debit numeric,
  credit numeric,
  memo text,
  running numeric,
  total_rows bigint,
  total_debit numeric,
  total_credit numeric
)
language sql
security invoker
stable
as $$
  with ledger as (
    select je.entry_date,
           je.narration,
           jl.id as line_id,
           jl.debit,
           jl.credit,
           jl.memo,
           sum(jl.debit - jl.credit) over (order by je.entry_date, jl.id
                                           rows between unbounded preceding and current row) as running
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where jl.account_id = p_account_id
  ),
  totals as (
    select count(*)::bigint as total_rows,
           coalesce(sum(debit), 0) as total_debit,
           coalesce(sum(credit), 0) as total_credit
    from ledger
  )
  select l.entry_date, l.narration, l.debit, l.credit, l.memo, l.running,
         t.total_rows, t.total_debit, t.total_credit
  from ledger l, totals t
  order by l.entry_date, l.line_id
  offset p_offset
  limit p_limit;
$$;

grant execute on function public.fn_account_ledger(uuid, int, int) to authenticated;

-- /reports/party-ledger is the same shape keyed by party_id.
create or replace function public.fn_party_ledger(p_party_id uuid, p_limit int, p_offset int)
returns table (
  entry_date date,
  narration text,
  debit numeric,
  credit numeric,
  memo text,
  running numeric,
  total_rows bigint,
  total_debit numeric,
  total_credit numeric
)
language sql
security invoker
stable
as $$
  with ledger as (
    select je.entry_date,
           je.narration,
           jl.id as line_id,
           jl.debit,
           jl.credit,
           jl.memo,
           sum(jl.debit - jl.credit) over (order by je.entry_date, jl.id
                                           rows between unbounded preceding and current row) as running
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where jl.party_id = p_party_id
  ),
  totals as (
    select count(*)::bigint as total_rows,
           coalesce(sum(debit), 0) as total_debit,
           coalesce(sum(credit), 0) as total_credit
    from ledger
  )
  select l.entry_date, l.narration, l.debit, l.credit, l.memo, l.running,
         t.total_rows, t.total_debit, t.total_credit
  from ledger l, totals t
  order by l.entry_date, l.line_id
  offset p_offset
  limit p_limit;
$$;

grant execute on function public.fn_party_ledger(uuid, int, int) to authenticated;
