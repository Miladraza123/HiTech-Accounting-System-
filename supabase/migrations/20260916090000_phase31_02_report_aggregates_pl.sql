-- Phase 31.02 — Report performance, part 1: journal date indexes + P&L aggregate
--
-- Every financial report (P&L, Cash Flow, Daily Ledger, General Ledger)
-- filters journal_entries by entry_date, and journal_entries is the
-- fastest-growing table in the system — every posted document writes one.
-- It had no index on entry_date at all, so each of those reports was a full
-- table scan. Confirmed against pg_indexes before writing this, not assumed.
create index if not exists idx_journal_entries_entry_date on public.journal_entries (entry_date);

-- The Journal Vouchers screen filters source_table = 'manual' and orders by
-- entry_date desc; this serves that exact access path.
create index if not exists idx_journal_entries_source_entry_date
  on public.journal_entries (source_table, entry_date desc);

-- Profit & Loss: /reports/profit-loss used to fetch every journal entry in
-- the period together with all of its lines and sum them per account in
-- JavaScript. For a real financial year that is the entire year's
-- transaction history shipped to the app on every page view. This returns
-- one row per account instead (bounded by the chart of accounts), which is
-- what the page actually renders.
--
-- `security invoker` — must respect exactly the same RLS the replaced
-- .select() went through. This is a query-shape change, never a
-- permission change.
--
-- Equivalence with the old JS: it keyed a Map by chart_of_accounts.code
-- (UNIQUE, so grouping by code is the same key), accumulated
-- `debit - credit`, and skipped lines with no account — journal_lines
-- .account_id is NOT NULL with an FK, so the inner join drops nothing the
-- old code kept.
create or replace function public.fn_profit_loss(p_from date, p_to date)
returns table (code text, name text, account_type text, net numeric)
language sql
security invoker
stable
as $$
  select coa.code,
         coa.name,
         coa.account_type,
         sum(jl.debit - jl.credit) as net
  from public.journal_entries je
  join public.journal_lines jl on jl.journal_entry_id = je.id
  join public.chart_of_accounts coa on coa.id = jl.account_id
  where je.entry_date >= p_from
    and je.entry_date <= p_to
  group by coa.code, coa.name, coa.account_type;
$$;

grant execute on function public.fn_profit_loss(date, date) to authenticated;
