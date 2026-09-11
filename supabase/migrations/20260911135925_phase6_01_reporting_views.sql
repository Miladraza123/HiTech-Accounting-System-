-- Trial Balance — per-account debit/credit rollup across the whole
-- journal. RLS-protected same as journal_lines/chart_of_accounts
-- underneath (security_invoker=true), so a non-Accounts/Owner/Auditor
-- user querying this directly would just see zero balances everywhere
-- (journal_lines rows are invisible to them) rather than an error —
-- the Reports pages themselves are also gated to those roles.
create or replace view public.trial_balance as
select
  coa.id as account_id,
  coa.code,
  coa.name,
  coa.account_type,
  coalesce(sum(jl.debit), 0) as total_debit,
  coalesce(sum(jl.credit), 0) as total_credit,
  coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0) as balance
from public.chart_of_accounts coa
left join public.journal_lines jl on jl.account_id = coa.id
group by coa.id, coa.code, coa.name, coa.account_type;

alter view public.trial_balance set (security_invoker = true);
grant select on public.trial_balance to authenticated;

-- Per-client / per-supplier outstanding rollups — Customer 360 &
-- Client Credit Control read straight off these instead of re-summing
-- invoice_outstanding / supplier_bill_outstanding themselves everywhere.
create or replace view public.party_ar_summary as
select party_id, sum(outstanding_amount) as total_outstanding
from public.invoice_outstanding
group by party_id;

alter view public.party_ar_summary set (security_invoker = true);
grant select on public.party_ar_summary to authenticated;

create or replace view public.party_ap_summary as
select supplier_id, sum(outstanding_amount) as total_outstanding
from public.supplier_bill_outstanding
group by supplier_id;

alter view public.party_ap_summary set (security_invoker = true);
grant select on public.party_ap_summary to authenticated;
