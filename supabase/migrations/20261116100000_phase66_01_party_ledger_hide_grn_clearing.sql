-- Phase 66.01: the Customer / Supplier statement no longer shows GRN values.
--
-- A GRN posts Cr "GRN Clearing" (1330) against the supplier, and the Supplier Bill later posts a matching
-- Dr 1330 plus the Cr Trade Payables (2100). The supplier's real balance comes from the bill, so the GRN
-- credit (and the clearing line that cancels it) only cluttered the statement. The statement now leaves out
-- every 1330 line; bills (2100), payments and opening balances are shown exactly as before.
--
-- Read-only function change: no journal entry, GRN, bill or payment is touched, and the Trial Balance and
-- account ledgers still show 1330. A GRN that has no bill yet therefore does not appear on the statement
-- until its bill is entered.
create or replace function public.fn_party_ledger(p_party_id uuid, p_limit integer, p_offset integer)
returns table(entry_date date, narration text, debit numeric, credit numeric, memo text, running numeric, total_rows bigint, total_debit numeric, total_credit numeric)
language sql
stable
set search_path to 'public'
as $fn$
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
    join public.chart_of_accounts coa on coa.id = jl.account_id
    where jl.party_id = p_party_id
      and coa.code <> '1330'
      and not (
        je.source_table = 'invoices'
        and je.source_id in (select id from public.invoices where status = 'Cancelled')
      )
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
$fn$;
