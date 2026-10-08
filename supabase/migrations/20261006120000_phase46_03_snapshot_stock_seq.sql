-- Phase 46.03: Daily Snapshot stock follows the stock_ledger posting order.
--
-- phase46_01 rewrote _fn_generate_daily_snapshot_core before phase46_02 added
-- stock_ledger.seq, so it still picked each item+warehouse's "latest" row by
-- created_at desc, id desc -- the ordering 46_02 replaced everywhere else
-- because rows posted in one transaction share created_at and the uuid
-- tie-break is random. Same body, ordered by seq.
create or replace function public._fn_generate_daily_snapshot_core(p_date date)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cash numeric; v_bank numeric; v_petty numeric; v_stock numeric;
  v_ar numeric; v_ap numeric; v_sales numeric; v_collections numeric;
  v_payments numeric; v_expenses numeric; v_id uuid;
  v_day_end timestamptz := ((p_date + 1)::timestamp at time zone 'Asia/Karachi');
begin
  if p_date is null then
    raise exception 'A snapshot date is required.';
  end if;

  select
    coalesce(sum(jl.debit - jl.credit) filter (where coa.code = '1050'), 0),
    coalesce(sum(jl.debit - jl.credit) filter (where jl.bank_account_id is not null), 0),
    coalesce(sum(jl.debit - jl.credit) filter (where jl.petty_cash_fund_id is not null), 0),
    coalesce(sum(jl.debit - jl.credit) filter (where coa.code = '1200'), 0),
    coalesce(sum(jl.credit - jl.debit) filter (where coa.code = '2100'), 0)
  into v_cash, v_bank, v_petty, v_ar, v_ap
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  join public.chart_of_accounts coa on coa.id = jl.account_id
  where je.entry_date <= p_date;

  select coalesce(sum(round(s.running_balance * s.avg_cost, 2)), 0) into v_stock
  from (
    select distinct on (sl.item_id, sl.warehouse_id) sl.running_balance, sl.avg_cost
    from public.stock_ledger sl
    where sl.created_at < v_day_end
    order by sl.item_id, sl.warehouse_id, sl.seq desc
  ) s;

  select coalesce(sum(grand_total), 0) into v_sales
    from public.invoices where invoice_date = p_date and status = 'Posted';
  select coalesce(sum(amount), 0) into v_collections
    from public.payments where payment_date = p_date and status = 'Posted' and direction = 'receipt';
  select coalesce(sum(amount), 0) into v_payments
    from public.payments where payment_date = p_date and status = 'Posted' and direction = 'payment';
  select coalesce(sum(amount), 0) into v_expenses
    from public.expenses where expense_date = p_date and status = 'Posted';

  insert into public.daily_snapshots
    (snapshot_date, cash_in_hand, bank_balance, petty_cash_balance, stock_value,
     total_ar_outstanding, total_ap_outstanding, sales_today, collections_today,
     payments_today, expenses_today, generated_by)
  values
    (p_date, v_cash, v_bank, v_petty, v_stock, v_ar, v_ap, v_sales, v_collections,
     v_payments, v_expenses, auth.uid())
  on conflict (snapshot_date) do update set
    cash_in_hand = excluded.cash_in_hand,
    bank_balance = excluded.bank_balance,
    petty_cash_balance = excluded.petty_cash_balance,
    stock_value = excluded.stock_value,
    total_ar_outstanding = excluded.total_ar_outstanding,
    total_ap_outstanding = excluded.total_ap_outstanding,
    sales_today = excluded.sales_today,
    collections_today = excluded.collections_today,
    payments_today = excluded.payments_today,
    expenses_today = excluded.expenses_today,
    generated_at = now(),
    generated_by = excluded.generated_by
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public._fn_generate_daily_snapshot_core(date) from public, anon, authenticated;
