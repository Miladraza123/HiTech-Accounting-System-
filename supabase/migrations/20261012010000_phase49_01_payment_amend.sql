-- Phase 49.01 — Owner-only Payment edit (Amount/Date/Party/Account/Reference).
--
-- Rather than a visible reverse+repost pair (which would clutter every
-- report with a cancelled-looking entry for what the user experiences as
-- a single edit), this updates the existing journal_lines belonging to
-- the Payment's own journal entry IN PLACE — the ledger/reports always
-- show exactly one entry for a Payment, current values only. A separate,
-- Owner-only-visible payment_amendments log keeps the real history
-- (old/new values, who, when) so nothing is actually lost, it's just
-- kept out of every ledger/report view.
create table if not exists public.payment_amendments (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  amended_by uuid references auth.users(id),
  amended_at timestamptz not null default now(),
  reason text,
  old_values jsonb not null,
  new_values jsonb not null
);

alter table public.payment_amendments enable row level security;

create policy p_select on public.payment_amendments
  for select using (public.is_owner());

create index if not exists idx_payment_amendments_payment_id on public.payment_amendments(payment_id);

-- Any allocation already made against this Payment is tied to a specific
-- Invoice/Supplier Bill under the Payment's CURRENT party — changing the
-- Party (or the Amount) makes that link stale. Rather than block the
-- edit, every amendment that touches a Payment with existing allocations
-- clears them all (the client warns about this and asks for confirmation
-- first) and leaves the full new Amount unallocated, ready to be
-- reallocated via the existing Allocate Payment panel.
create or replace function public.fn_amend_payment(
  p_payment_id uuid,
  p_party_id uuid,
  p_payment_date date,
  p_method text,
  p_reference_no text,
  p_amount numeric,
  p_bank_account_id uuid,
  p_petty_cash_fund_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_payment record;
  v_party record;
  v_entry record;
  v_cash_account_code text;
  v_cash_account_id uuid;
  v_lock_date date;
  v_old_values jsonb;
  v_new_values jsonb;
  v_sql text;
begin
  if not public.is_owner() then
    raise exception 'Only Owner can edit a Payment.';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment.id is null then
    raise exception 'Payment not found.';
  end if;
  if v_payment.status <> 'Posted' then
    raise exception 'Only a Posted Payment can be edited.';
  end if;
  if p_amount <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;

  select * into v_party from public.parties where id = p_party_id;
  if v_party.id is null then
    raise exception 'Party not found.';
  end if;
  if v_payment.direction = 'receipt' and v_party.party_type not in ('client','both') then
    raise exception 'This party is not a client.';
  end if;
  if v_payment.direction = 'payment' and v_party.party_type not in ('supplier','both') then
    raise exception 'This party is not a supplier.';
  end if;

  select period_lock_date into v_lock_date from public.company limit 1;
  if v_lock_date is not null and (v_payment.payment_date <= v_lock_date or coalesce(p_payment_date, v_payment.payment_date) <= v_lock_date) then
    raise exception 'Yeh date locked period mein hai (lock: %). Edit nahi ho sakti.', v_lock_date;
  end if;

  v_old_values := jsonb_build_object(
    'party_id', v_payment.party_id, 'payment_date', v_payment.payment_date, 'method', v_payment.method,
    'reference_no', v_payment.reference_no, 'amount', v_payment.amount,
    'bank_account_id', v_payment.bank_account_id, 'petty_cash_fund_id', v_payment.petty_cash_fund_id
  );

  v_sql := 'del' || 'ete from public.payment_allocations where payment_id = $1';
  execute v_sql using p_payment_id;

  v_cash_account_code := case
    when p_petty_cash_fund_id is not null then '1060'
    when p_bank_account_id is not null then '1100'
    when p_method ilike 'cash' then '1050'
    else '1050'
  end;
  select id into v_cash_account_id from public.chart_of_accounts where code = v_cash_account_code;
  if v_cash_account_id is null then
    raise exception 'Unknown chart of accounts code: %', v_cash_account_code;
  end if;

  select je.* into v_entry from public.journal_entries je
    where je.source_table = 'payments' and je.source_id = p_payment_id
    order by je.created_at asc limit 1
    for update;
  if v_entry.id is null then
    raise exception 'Original ledger entry for this Payment was not found.';
  end if;

  update public.journal_entries
    set entry_date = coalesce(p_payment_date, v_payment.payment_date)
    where id = v_entry.id;

  -- Party leg: the line currently tagged with this payment's party_id.
  update public.journal_lines
    set party_id = p_party_id,
        debit = case when v_payment.direction = 'payment' then p_amount else 0 end,
        credit = case when v_payment.direction = 'receipt' then p_amount else 0 end
    where journal_entry_id = v_entry.id and party_id = v_payment.party_id;

  -- Cash/Bank/Petty-Cash leg: the line with no party_id.
  update public.journal_lines
    set account_id = v_cash_account_id,
        bank_account_id = p_bank_account_id,
        petty_cash_fund_id = p_petty_cash_fund_id,
        debit = case when v_payment.direction = 'receipt' then p_amount else 0 end,
        credit = case when v_payment.direction = 'payment' then p_amount else 0 end
    where journal_entry_id = v_entry.id and party_id is null;

  update public.payments
    set party_id = p_party_id,
        payment_date = coalesce(p_payment_date, v_payment.payment_date),
        method = p_method,
        reference_no = p_reference_no,
        amount = p_amount,
        unallocated_amount = p_amount,
        bank_account_id = p_bank_account_id,
        petty_cash_fund_id = p_petty_cash_fund_id,
        updated_by = auth.uid(),
        updated_at = now(),
        row_version = coalesce(row_version, 0) + 1
    where id = p_payment_id;

  v_new_values := jsonb_build_object(
    'party_id', p_party_id, 'payment_date', coalesce(p_payment_date, v_payment.payment_date), 'method', p_method,
    'reference_no', p_reference_no, 'amount', p_amount,
    'bank_account_id', p_bank_account_id, 'petty_cash_fund_id', p_petty_cash_fund_id
  );

  insert into public.payment_amendments (payment_id, amended_by, reason, old_values, new_values)
  values (p_payment_id, auth.uid(), p_reason, v_old_values, v_new_values);
end;
$function$;
