-- The NewPaymentForm UI now always sends an explicit source (Cash in Hand /
-- Bank / Petty Cash) with bank_account_id or petty_cash_fund_id set whenever
-- the source isn't plain cash — "method" is now just a free-text note, not a
-- routing signal. So "neither id given" now unambiguously means Cash in Hand;
-- the old fallback to the Bank control account (1100) for that case was only
-- ever a legacy safety net and is now simply wrong. Fixing the final fallback
-- in both functions from 1100 to 1050 (the 'method ilike cash' branch is kept,
-- harmless, for any other/future caller that does pass a literal 'cash' method).
create or replace function public.fn_create_payment(
  p_party_id uuid, p_direction text, p_payment_date date, p_method text, p_reference_no text,
  p_amount numeric, p_notes text, p_allocations jsonb,
  p_bank_account_id uuid default null, p_petty_cash_fund_id uuid default null
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_party record;
  v_payment_id uuid;
  v_payment_no text;
  v_line jsonb;
  v_alloc_total numeric := 0;
  v_outstanding numeric;
  v_cash_account_code text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Payment record kar sakte hain.';
  end if;
  if p_direction not in ('receipt','payment') then
    raise exception 'Direction ghalat hai.';
  end if;
  if p_amount <= 0 then
    raise exception 'Amount zero se zyada hona chahiye.';
  end if;

  select * into v_party from public.parties where id = p_party_id;
  if v_party.id is null then
    raise exception 'Party nahi mili.';
  end if;
  if p_direction = 'receipt' and v_party.party_type not in ('client','both') then
    raise exception 'Yeh party client nahi hai.';
  end if;
  if p_direction = 'payment' and v_party.party_type not in ('supplier','both') then
    raise exception 'Yeh party supplier nahi hai.';
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_alloc_total := v_alloc_total + (v_line->>'amount')::numeric;
  end loop;
  if v_alloc_total > p_amount then
    raise exception 'Allocation total payment amount se zyada nahi ho sakti.';
  end if;

  v_cash_account_code := case
    when p_petty_cash_fund_id is not null then '1060'
    when p_bank_account_id is not null then '1100'
    when p_method ilike 'cash' then '1050'
    else '1050'
  end;

  select public.fn_get_next_number('PAY') into v_payment_no;

  insert into public.payments
    (payment_no, party_id, direction, payment_date, method, reference_no, amount, unallocated_amount, notes,
     bank_account_id, petty_cash_fund_id, created_by)
  values
    (v_payment_no, p_party_id, p_direction, coalesce(p_payment_date, current_date), p_method, p_reference_no,
     p_amount, p_amount - v_alloc_total, p_notes, p_bank_account_id, p_petty_cash_fund_id, auth.uid())
  returning id into v_payment_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    if p_direction = 'receipt' then
      perform pg_advisory_xact_lock(hashtextextended('invoice:' || (v_line->>'invoice_id'), 0));

      select outstanding_amount into v_outstanding from public.invoice_outstanding
        where invoice_id = (v_line->>'invoice_id')::uuid and party_id = p_party_id;
      if v_outstanding is null then
        raise exception 'Invoice is party ki nahi hai ya mili nahi.';
      end if;
      if (v_line->>'amount')::numeric > v_outstanding then
        raise exception 'Allocation outstanding amount se zyada hai (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, invoice_id, amount)
      values (v_payment_id, (v_line->>'invoice_id')::uuid, (v_line->>'amount')::numeric);
    else
      perform pg_advisory_xact_lock(hashtextextended('supplier_bill:' || (v_line->>'supplier_bill_id'), 0));

      select outstanding_amount into v_outstanding from public.supplier_bill_outstanding
        where supplier_bill_id = (v_line->>'supplier_bill_id')::uuid and supplier_id = p_party_id;
      if v_outstanding is null then
        raise exception 'Supplier Bill is party ki nahi hai ya mili nahi.';
      end if;
      if (v_line->>'amount')::numeric > v_outstanding then
        raise exception 'Allocation outstanding amount se zyada hai (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, supplier_bill_id, amount)
      values (v_payment_id, (v_line->>'supplier_bill_id')::uuid, (v_line->>'amount')::numeric);
    end if;
  end loop;

  if p_direction = 'receipt' then
    perform public._fn_post_journal_entry_core(
      coalesce(p_payment_date, current_date), 'Receipt ' || v_payment_no, 'payments', v_payment_id,
      jsonb_build_array(
        jsonb_build_object('account_code', v_cash_account_code, 'bank_account_id', p_bank_account_id, 'petty_cash_fund_id', p_petty_cash_fund_id, 'debit', p_amount, 'credit', 0, 'memo', 'Cash/Bank received'),
        jsonb_build_object('account_code', '1200', 'party_id', p_party_id, 'debit', 0, 'credit', p_amount, 'memo', 'Trade Receivables')
      )
    );
  else
    perform public._fn_post_journal_entry_core(
      coalesce(p_payment_date, current_date), 'Payment ' || v_payment_no, 'payments', v_payment_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '2100', 'party_id', p_party_id, 'debit', p_amount, 'credit', 0, 'memo', 'Trade Payables'),
        jsonb_build_object('account_code', v_cash_account_code, 'bank_account_id', p_bank_account_id, 'petty_cash_fund_id', p_petty_cash_fund_id, 'debit', 0, 'credit', p_amount, 'memo', 'Cash/Bank paid')
      )
    );
  end if;

  return v_payment_id;
end;
$function$;

create or replace function public.fn_cancel_payment(p_payment_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_payment record;
  v_lines jsonb;
  v_cash_account_code text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Payment cancel kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancel karne ki wajah likhna zaroori hai.';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment.id is null then
    raise exception 'Payment nahi mili.';
  end if;
  if v_payment.status = 'Cancelled' then
    raise exception 'Yeh Payment pehle se cancel hai.';
  end if;

  v_cash_account_code := case
    when v_payment.petty_cash_fund_id is not null then '1060'
    when v_payment.bank_account_id is not null then '1100'
    when v_payment.method ilike 'cash' then '1050'
    else '1050'
  end;

  if v_payment.direction = 'receipt' then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '1200', 'party_id', v_payment.party_id, 'debit', v_payment.amount, 'credit', 0, 'memo', 'Trade Receivables — reversed'),
      jsonb_build_object('account_code', v_cash_account_code, 'bank_account_id', v_payment.bank_account_id, 'petty_cash_fund_id', v_payment.petty_cash_fund_id, 'debit', 0, 'credit', v_payment.amount, 'memo', 'Cash/Bank — reversed')
    );
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', v_cash_account_code, 'bank_account_id', v_payment.bank_account_id, 'petty_cash_fund_id', v_payment.petty_cash_fund_id, 'debit', v_payment.amount, 'credit', 0, 'memo', 'Cash/Bank — reversed'),
      jsonb_build_object('account_code', '2100', 'party_id', v_payment.party_id, 'debit', 0, 'credit', v_payment.amount, 'memo', 'Trade Payables — reversed')
    );
  end if;

  perform public._fn_post_journal_entry_core(
    current_date,
    (case when v_payment.direction = 'receipt' then 'Receipt ' else 'Payment ' end) || v_payment.payment_no || ' — cancelled',
    'payments', p_payment_id, v_lines
  );

  update public.payments set status = 'Cancelled', cancel_reason = p_reason where id = p_payment_id;
end;
$function$;
