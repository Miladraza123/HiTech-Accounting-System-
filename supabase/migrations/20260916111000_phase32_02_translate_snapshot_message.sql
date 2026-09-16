-- One exception message was still in Roman Urdu. The earlier translation round
-- covered 62 functions but missed this one; a sweep of every function body in
-- the schema (two independent patterns) confirms it was the only remaining
-- case, and that none are left now.
create or replace function public.fn_generate_daily_snapshot(p_date date default current_date)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cash numeric; v_bank numeric; v_petty numeric; v_stock numeric;
  v_ar numeric; v_ap numeric; v_sales numeric; v_collections numeric;
  v_payments numeric; v_expenses numeric; v_id uuid;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can generate the Daily Snapshot.';
  end if;

  select coalesce(balance, 0) into v_cash from public.cash_in_hand_balance;
  select coalesce(sum(balance), 0) into v_bank from public.bank_account_balances;
  select coalesce(sum(balance), 0) into v_petty from public.petty_cash_fund_balances;
  select coalesce(sum(stock_value), 0) into v_stock from public.current_stock;
  select coalesce(sum(total_outstanding), 0) into v_ar from public.party_ar_summary;
  select coalesce(sum(total_outstanding), 0) into v_ap from public.party_ap_summary;

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
