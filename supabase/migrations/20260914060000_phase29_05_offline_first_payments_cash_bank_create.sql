-- Phase 29.05 — Master Offline-First Roadmap, Phase 5: offline-first
-- CREATE for Payment/Receipt, Expense (cash/bank/petty-cash spending),
-- Bank Account, and Petty Cash Fund.
--
-- The plan's own note for this phase: "Highest financial-sensitivity
-- phase — duplicate payment postings are a real-money risk, so
-- idempotency keys get the most scrutiny/testing here." Same
-- idempotent-create pattern as every earlier phase: client-generated
-- UUID, safe to call twice with the same id — but this is the phase
-- where getting that right actually matters most, since a duplicate here
-- is a duplicate cash receipt/payment, not just a duplicate document.
--
-- fn_create_payment — confirmed by reading the actual function body, not
-- assumed: allocation against an Invoice/Supplier Bill already takes a
-- `pg_advisory_xact_lock` per target document and re-reads LIVE
-- outstanding_amount from invoice_outstanding/supplier_bill_outstanding
-- (both views computed from real postings, not a client-supplied number)
-- before accepting the allocation — so a queued offline payment that
-- would over-allocate against a bill someone else already
-- partly/fully paid while this device was offline is correctly rejected
-- at sync time, never blindly trusting a stale offline snapshot. This
-- required no new validation logic.
--
-- Batch payments (MultiPaymentForm.tsx / fn_create_payments_batch)
-- deliberately do NOT get a new "batch" RPC here: fn_create_payments_batch
-- already just calls fn_create_payment once per row inside one
-- transaction, so the offline path instead queues each row as its own
-- independent "payments" create (see offlineQueue.ts) replayed through
-- this same fn_create_payment_idempotent — each row gets its own
-- client-generated id, its own retry/backoff if it fails, and one bad
-- row never blocks the others from syncing (a strictly better failure
-- mode offline than the online batch RPC's all-or-nothing behavior,
-- which is fine online since a failure there is caught immediately and
-- resubmitted by a present, attentive user).
--
-- Bank Account / Petty Cash Fund creation follow the exact same pattern
-- as Warehouse in Phase 1 — simple master-data creation, including their
-- optional opening-balance journal entry.

create or replace function public.fn_create_payment_idempotent(
  p_id uuid,
  p_party_id uuid, p_direction text, p_payment_date date, p_method text, p_reference_no text,
  p_amount numeric, p_notes text, p_allocations jsonb,
  p_bank_account_id uuid default null, p_petty_cash_fund_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party record;
  v_existing uuid;
  v_payment_no text;
  v_line jsonb;
  v_alloc_total numeric := 0;
  v_outstanding numeric;
  v_cash_account_code text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can record a Payment.';
  end if;

  select id into v_existing from public.payments where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_direction not in ('receipt','payment') then
    raise exception 'Invalid direction.';
  end if;
  if p_amount <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;

  select * into v_party from public.parties where id = p_party_id;
  if v_party.id is null then
    raise exception 'Party not found.';
  end if;
  if p_direction = 'receipt' and v_party.party_type not in ('client','both') then
    raise exception 'This party is not a Client.';
  end if;
  if p_direction = 'payment' and v_party.party_type not in ('supplier','both') then
    raise exception 'This party is not a Supplier.';
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_alloc_total := v_alloc_total + (v_line->>'amount')::numeric;
  end loop;
  if v_alloc_total > p_amount then
    raise exception 'Allocation total cannot exceed the payment amount.';
  end if;

  v_cash_account_code := case
    when p_petty_cash_fund_id is not null then '1060'
    when p_bank_account_id is not null then '1100'
    when p_method ilike 'cash' then '1050'
    else '1050'
  end;

  select public.fn_get_next_number('PAY') into v_payment_no;

  insert into public.payments
    (id, payment_no, party_id, direction, payment_date, method, reference_no, amount, unallocated_amount, notes,
     bank_account_id, petty_cash_fund_id, created_by)
  values
    (p_id, v_payment_no, p_party_id, p_direction, coalesce(p_payment_date, current_date), p_method, p_reference_no,
     p_amount, p_amount - v_alloc_total, p_notes, p_bank_account_id, p_petty_cash_fund_id, auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.payments where id = p_id;
    return v_existing;
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    if p_direction = 'receipt' then
      perform pg_advisory_xact_lock(hashtextextended('invoice:' || (v_line->>'invoice_id'), 0));

      select outstanding_amount into v_outstanding from public.invoice_outstanding
        where invoice_id = (v_line->>'invoice_id')::uuid and party_id = p_party_id;
      if v_outstanding is null then
        raise exception 'Invoice does not belong to this party, or was not found.';
      end if;
      if (v_line->>'amount')::numeric > v_outstanding then
        raise exception 'Allocation exceeds the outstanding amount (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, invoice_id, amount)
      values (p_id, (v_line->>'invoice_id')::uuid, (v_line->>'amount')::numeric);
    else
      perform pg_advisory_xact_lock(hashtextextended('supplier_bill:' || (v_line->>'supplier_bill_id'), 0));

      select outstanding_amount into v_outstanding from public.supplier_bill_outstanding
        where supplier_bill_id = (v_line->>'supplier_bill_id')::uuid and supplier_id = p_party_id;
      if v_outstanding is null then
        raise exception 'Supplier Bill does not belong to this party, or was not found.';
      end if;
      if (v_line->>'amount')::numeric > v_outstanding then
        raise exception 'Allocation exceeds the outstanding amount (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, supplier_bill_id, amount)
      values (p_id, (v_line->>'supplier_bill_id')::uuid, (v_line->>'amount')::numeric);
    end if;
  end loop;

  if p_direction = 'receipt' then
    perform public._fn_post_journal_entry_core(
      coalesce(p_payment_date, current_date), 'Receipt ' || v_payment_no, 'payments', p_id,
      jsonb_build_array(
        jsonb_build_object('account_code', v_cash_account_code, 'bank_account_id', p_bank_account_id, 'petty_cash_fund_id', p_petty_cash_fund_id, 'debit', p_amount, 'credit', 0, 'memo', 'Cash/Bank received'),
        jsonb_build_object('account_code', '1200', 'party_id', p_party_id, 'debit', 0, 'credit', p_amount, 'memo', 'Trade Receivables')
      )
    );
  else
    perform public._fn_post_journal_entry_core(
      coalesce(p_payment_date, current_date), 'Payment ' || v_payment_no, 'payments', p_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '2100', 'party_id', p_party_id, 'debit', p_amount, 'credit', 0, 'memo', 'Trade Payables'),
        jsonb_build_object('account_code', v_cash_account_code, 'bank_account_id', p_bank_account_id, 'petty_cash_fund_id', p_petty_cash_fund_id, 'debit', 0, 'credit', p_amount, 'memo', 'Cash/Bank paid')
      )
    );
  end if;

  return p_id;
end;
$$;

revoke execute on function public.fn_create_payment_idempotent(uuid, uuid, text, date, text, text, numeric, text, jsonb, uuid, uuid) from public, anon;
grant execute on function public.fn_create_payment_idempotent(uuid, uuid, text, date, text, text, numeric, text, jsonb, uuid, uuid) to authenticated;


create or replace function public.fn_create_expense_idempotent(
  p_id uuid,
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
set search_path = public
as $$
declare
  v_head record;
  v_existing uuid;
  v_expense_no text;
  v_credit_account_code text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can record an Expense.';
  end if;

  select id into v_existing from public.expenses where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_amount <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;
  if p_payment_source not in ('cash', 'bank', 'petty_cash') then
    raise exception 'Invalid payment source.';
  end if;
  if p_payment_source = 'bank' and p_bank_account_id is null then
    raise exception 'Select a Bank Account.';
  end if;
  if p_payment_source = 'petty_cash' and p_petty_cash_fund_id is null then
    raise exception 'Select a Petty Cash Fund.';
  end if;
  if coalesce(p_settlement_status, 'Settled') not in ('Settled','Pending') then
    raise exception 'Invalid settlement status.';
  end if;

  select * into v_head from public.expense_heads where id = p_expense_head_id and is_active;
  if v_head.id is null then
    raise exception 'Expense Head not found.';
  end if;

  v_credit_account_code := case p_payment_source when 'bank' then '1100' when 'petty_cash' then '1060' else '1050' end;

  select public.fn_get_next_number('EXP') into v_expense_no;

  insert into public.expenses
    (id, expense_no, expense_date, expense_head_id, amount, payment_source, bank_account_id, petty_cash_fund_id,
     job_id, responsible_user_id, department, description, vehicle_id, odometer_reading, fuel_litres, fuel_rate,
     settlement_status, created_by)
  values
    (p_id, v_expense_no, coalesce(p_expense_date, current_date), p_expense_head_id, p_amount, p_payment_source,
     case when p_payment_source = 'bank' then p_bank_account_id end,
     case when p_payment_source = 'petty_cash' then p_petty_cash_fund_id end,
     p_job_id, p_responsible_user_id, nullif(trim(p_department), ''), nullif(trim(p_description), ''),
     p_vehicle_id, p_odometer_reading, p_fuel_litres, p_fuel_rate, coalesce(p_settlement_status, 'Settled'), auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.expenses where id = p_id;
    return v_existing;
  end if;

  if p_vehicle_id is not null and p_odometer_reading is not null then
    update public.vehicles
      set current_meter_reading = p_odometer_reading
      where id = p_vehicle_id and p_odometer_reading > current_meter_reading;
  end if;

  perform public._fn_post_journal_entry_core(
    coalesce(p_expense_date, current_date), 'Expense ' || v_expense_no || ' — ' || v_head.name, 'expenses', p_id,
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

  return p_id;
end;
$$;

revoke execute on function public.fn_create_expense_idempotent(uuid, date, uuid, numeric, text, uuid, uuid, uuid, uuid, text, text, uuid, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.fn_create_expense_idempotent(uuid, date, uuid, numeric, text, uuid, uuid, uuid, uuid, text, text, uuid, numeric, numeric, numeric, text) to authenticated;


create or replace function public.fn_create_bank_account_idempotent(
  p_id uuid,
  p_account_name text, p_bank_name text, p_account_number text, p_branch text,
  p_opening_balance numeric default 0, p_opening_balance_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can create a Bank Account.';
  end if;

  select id into v_existing from public.bank_accounts where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if coalesce(trim(p_account_name), '') = '' then
    raise exception 'Account name is required.';
  end if;

  insert into public.bank_accounts (id, account_name, bank_name, account_number, branch, created_by)
  values (p_id, trim(p_account_name), nullif(trim(p_bank_name), ''), nullif(trim(p_account_number), ''), nullif(trim(p_branch), ''), auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.bank_accounts where id = p_id;
    return v_existing;
  end if;

  if coalesce(p_opening_balance, 0) <> 0 then
    perform public._fn_post_journal_entry_core(
      coalesce(p_opening_balance_date, current_date), 'Opening Balance — ' || trim(p_account_name), 'bank_accounts', p_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '1100', 'bank_account_id', p_id, 'debit', greatest(p_opening_balance, 0), 'credit', greatest(-p_opening_balance, 0), 'memo', 'Opening Balance'),
        jsonb_build_object('account_code', '1900', 'debit', greatest(-p_opening_balance, 0), 'credit', greatest(p_opening_balance, 0), 'memo', 'Opening Balance Equity')
      )
    );
  end if;

  return p_id;
end;
$$;

revoke execute on function public.fn_create_bank_account_idempotent(uuid, text, text, text, text, numeric, date) from public, anon;
grant execute on function public.fn_create_bank_account_idempotent(uuid, text, text, text, text, numeric, date) to authenticated;


create or replace function public.fn_create_petty_cash_fund_idempotent(
  p_id uuid,
  p_fund_name text, p_custodian_user_id uuid,
  p_opening_balance numeric default 0, p_opening_balance_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can create a Petty Cash Fund.';
  end if;

  select id into v_existing from public.petty_cash_funds where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if coalesce(trim(p_fund_name), '') = '' then
    raise exception 'Fund name is required.';
  end if;

  insert into public.petty_cash_funds (id, fund_name, custodian_user_id, created_by)
  values (p_id, trim(p_fund_name), p_custodian_user_id, auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.petty_cash_funds where id = p_id;
    return v_existing;
  end if;

  if coalesce(p_opening_balance, 0) <> 0 then
    perform public._fn_post_journal_entry_core(
      coalesce(p_opening_balance_date, current_date), 'Opening Balance — ' || trim(p_fund_name), 'petty_cash_funds', p_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '1060', 'petty_cash_fund_id', p_id, 'debit', greatest(p_opening_balance, 0), 'credit', greatest(-p_opening_balance, 0), 'memo', 'Opening Balance'),
        jsonb_build_object('account_code', '1900', 'debit', greatest(-p_opening_balance, 0), 'credit', greatest(p_opening_balance, 0), 'memo', 'Opening Balance Equity')
      )
    );
  end if;

  return p_id;
end;
$$;

revoke execute on function public.fn_create_petty_cash_fund_idempotent(uuid, text, uuid, numeric, date) from public, anon;
grant execute on function public.fn_create_petty_cash_fund_idempotent(uuid, text, uuid, numeric, date) to authenticated;
