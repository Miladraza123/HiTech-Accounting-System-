-- Finance data is no longer readable by every signed-in role.
--
-- journal_lines/audit_log were already limited to Owner/Accounts/Auditor,
-- but the documents they're built from were `using (true)`, so any role
-- (Dispatch, Production, ...) could read every payment, expense, bank
-- account number and, from supplier bills vs. invoices, the margins.
--
--   finance only (owner/accounts/auditor): payments, payment_allocations,
--     expenses, contra_transfers, bank_accounts, petty_cash_funds,
--     job_cost_ledger
--   finance + store: supplier_bills (+lines), purchase_returns (+lines) —
--     Store creates purchase returns from a bill, and already sees PO rates
--   finance + sales: invoices (+lines), sales_returns (+lines)
--
-- All writes go through SECURITY DEFINER functions, which are unaffected.

-- The outstanding views run with the caller's rights and LEFT JOIN the
-- payment tables, so once those are hidden Sales would get every invoice's
-- full amount as "outstanding" (and Store every bill's) — wrong credit
-- warnings, client balances and aging. Allocated amounts now come from
-- definer helpers that answer only for roles allowed to see the document.
create or replace function public.fn_invoice_allocated_amount(p_invoice_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_owner() or public.has_role('accounts') or public.has_role('auditor') or public.has_role('sales')
      then (select coalesce(sum(pa.amount), 0)
              from public.payment_allocations pa
              join public.payments p on p.id = pa.payment_id
             where pa.invoice_id = p_invoice_id and p.status = 'Posted')
    else 0::numeric
  end;
$$;

create or replace function public.fn_supplier_bill_allocated_amount(p_supplier_bill_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_owner() or public.has_role('accounts') or public.has_role('auditor') or public.has_role('store')
      then (select coalesce(sum(pa.amount), 0)
              from public.payment_allocations pa
              join public.payments p on p.id = pa.payment_id
             where pa.supplier_bill_id = p_supplier_bill_id and p.status = 'Posted')
    else 0::numeric
  end;
$$;

revoke execute on function public.fn_invoice_allocated_amount(uuid) from public, anon;
revoke execute on function public.fn_supplier_bill_allocated_amount(uuid) from public, anon;
grant execute on function public.fn_invoice_allocated_amount(uuid) to authenticated;
grant execute on function public.fn_supplier_bill_allocated_amount(uuid) to authenticated;

create or replace view public.invoice_outstanding with (security_invoker = true) as
select
  i.id as invoice_id,
  i.party_id,
  i.grand_total,
  public.fn_invoice_allocated_amount(i.id) as allocated_amount,
  i.grand_total - public.fn_invoice_allocated_amount(i.id) - coalesce(sr.returned_total, 0::numeric) as outstanding_amount,
  coalesce(sr.returned_total, 0::numeric) as returned_amount
from public.invoices i
left join (
  select sales_returns.invoice_id, sum(sales_returns.grand_total) as returned_total
  from public.sales_returns
  where sales_returns.status = 'Posted'
  group by sales_returns.invoice_id
) sr on sr.invoice_id = i.id
where i.status = 'Posted';

create or replace view public.supplier_bill_outstanding with (security_invoker = true) as
select
  b.id as supplier_bill_id,
  b.supplier_id,
  b.grand_total,
  public.fn_supplier_bill_allocated_amount(b.id) as allocated_amount,
  b.grand_total - public.fn_supplier_bill_allocated_amount(b.id) - coalesce(pr.returned_total, 0::numeric) as outstanding_amount,
  coalesce(pr.returned_total, 0::numeric) as returned_amount
from public.supplier_bills b
left join (
  select purchase_returns.supplier_bill_id, sum(purchase_returns.grand_total) as returned_total
  from public.purchase_returns
  where purchase_returns.status = 'Posted'
  group by purchase_returns.supplier_bill_id
) pr on pr.supplier_bill_id = b.id
where b.status = 'Posted';

alter policy p_select on public.payments using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor'));
alter policy p_select on public.payment_allocations using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor'));
alter policy p_select on public.expenses using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor'));
alter policy p_select on public.contra_transfers using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor'));
alter policy p_select on public.bank_accounts using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor'));
alter policy p_select on public.petty_cash_funds using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor'));
alter policy p_select on public.job_cost_ledger using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor'));

alter policy p_select on public.supplier_bills using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor') or public.has_role('store'));
alter policy p_select on public.supplier_bill_lines using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor') or public.has_role('store'));
alter policy p_select on public.purchase_returns using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor') or public.has_role('store'));
alter policy p_select on public.purchase_return_lines using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor') or public.has_role('store'));

alter policy p_select on public.invoices using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor') or public.has_role('sales'));
alter policy p_select on public.invoice_lines using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor') or public.has_role('sales'));
alter policy p_select on public.sales_returns using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor') or public.has_role('sales'));
alter policy p_select on public.sales_return_lines using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor') or public.has_role('sales'));
