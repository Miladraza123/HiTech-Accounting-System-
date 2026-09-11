-- Bill-wise Payment & Recovery — one function for both directions.
-- 'receipt': money in from a client, optionally allocated against one
-- or more Invoices (bill-wise). 'payment': money out to a supplier,
-- allocated against Supplier Bills. Allocation may be partial — the
-- remainder sits as unallocated_amount (an on-account advance) and can
-- be applied later via fn_allocate_payment.
create or replace function public.fn_create_payment(
  p_party_id uuid,
  p_direction text,
  p_payment_date date,
  p_method text,
  p_reference_no text,
  p_amount numeric,
  p_notes text,
  p_allocations jsonb -- [{invoice_id | supplier_bill_id, amount}]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party record;
  v_payment_id uuid;
  v_payment_no text;
  v_line jsonb;
  v_alloc_total numeric := 0;
  v_outstanding numeric;
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

  select public.fn_get_next_number('PAY') into v_payment_no;

  insert into public.payments
    (payment_no, party_id, direction, payment_date, method, reference_no, amount, unallocated_amount, notes, created_by)
  values
    (v_payment_no, p_party_id, p_direction, coalesce(p_payment_date, current_date), p_method, p_reference_no, p_amount, p_amount - v_alloc_total, p_notes, auth.uid())
  returning id into v_payment_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    if p_direction = 'receipt' then
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
        jsonb_build_object('account_code', '1100', 'party_id', null, 'debit', p_amount, 'credit', 0, 'memo', 'Bank/Cash'),
        jsonb_build_object('account_code', '1200', 'party_id', p_party_id, 'debit', 0, 'credit', p_amount, 'memo', 'Trade Receivables')
      )
    );
  else
    perform public._fn_post_journal_entry_core(
      coalesce(p_payment_date, current_date), 'Payment ' || v_payment_no, 'payments', v_payment_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '2100', 'party_id', p_party_id, 'debit', p_amount, 'credit', 0, 'memo', 'Trade Payables'),
        jsonb_build_object('account_code', '1100', 'party_id', null, 'debit', 0, 'credit', p_amount, 'memo', 'Bank/Cash')
      )
    );
  end if;

  return v_payment_id;
end;
$$;

-- Apply a previously-unallocated remainder (an on-account advance) to
-- specific Invoices/Supplier Bills later.
create or replace function public.fn_allocate_payment(p_payment_id uuid, p_allocations jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_line jsonb;
  v_alloc_total numeric := 0;
  v_outstanding numeric;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts allocate kar sakte hain.';
  end if;
  if jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) = 0 then
    raise exception 'Kam az kam ek allocation honi chahiye.';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment.id is null then
    raise exception 'Payment nahi mili.';
  end if;
  if v_payment.status <> 'Posted' then
    raise exception 'Yeh Payment Posted nahi hai.';
  end if;

  for v_line in select * from jsonb_array_elements(p_allocations) loop
    v_alloc_total := v_alloc_total + (v_line->>'amount')::numeric;
  end loop;
  if v_alloc_total > v_payment.unallocated_amount then
    raise exception 'Allocation unallocated amount se zyada hai (unallocated: %).', v_payment.unallocated_amount;
  end if;

  for v_line in select * from jsonb_array_elements(p_allocations) loop
    if v_payment.direction = 'receipt' then
      select outstanding_amount into v_outstanding from public.invoice_outstanding
        where invoice_id = (v_line->>'invoice_id')::uuid and party_id = v_payment.party_id;
      if v_outstanding is null then
        raise exception 'Invoice is party ki nahi hai ya mili nahi.';
      end if;
      if (v_line->>'amount')::numeric > v_outstanding then
        raise exception 'Allocation outstanding se zyada hai (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, invoice_id, amount)
      values (p_payment_id, (v_line->>'invoice_id')::uuid, (v_line->>'amount')::numeric);
    else
      select outstanding_amount into v_outstanding from public.supplier_bill_outstanding
        where supplier_bill_id = (v_line->>'supplier_bill_id')::uuid and supplier_id = v_payment.party_id;
      if v_outstanding is null then
        raise exception 'Supplier Bill is party ki nahi hai ya mili nahi.';
      end if;
      if (v_line->>'amount')::numeric > v_outstanding then
        raise exception 'Allocation outstanding se zyada hai (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, supplier_bill_id, amount)
      values (p_payment_id, (v_line->>'supplier_bill_id')::uuid, (v_line->>'amount')::numeric);
    end if;
  end loop;

  update public.payments set unallocated_amount = unallocated_amount - v_alloc_total where id = p_payment_id;
end;
$$;

create or replace function public.fn_cancel_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_lines jsonb;
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

  if v_payment.direction = 'receipt' then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '1200', 'party_id', v_payment.party_id, 'debit', v_payment.amount, 'credit', 0, 'memo', 'Trade Receivables — reversed'),
      jsonb_build_object('account_code', '1100', 'party_id', null, 'debit', 0, 'credit', v_payment.amount, 'memo', 'Bank/Cash — reversed')
    );
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '1100', 'party_id', null, 'debit', v_payment.amount, 'credit', 0, 'memo', 'Bank/Cash — reversed'),
      jsonb_build_object('account_code', '2100', 'party_id', v_payment.party_id, 'debit', 0, 'credit', v_payment.amount, 'memo', 'Trade Payables — reversed')
    );
  end if;

  perform public._fn_post_journal_entry_core(
    current_date,
    (case when v_payment.direction = 'receipt' then 'Receipt ' else 'Payment ' end) || v_payment.payment_no || ' — cancelled',
    'payments', p_payment_id, v_lines
  );

  -- payment_allocations rows are left in place as history — the
  -- invoice_outstanding / supplier_bill_outstanding views already
  -- filter on the payment's own status='Posted', so cancelling here
  -- alone correctly frees up the outstanding balance again.
  update public.payments set status = 'Cancelled', cancel_reason = p_reason where id = p_payment_id;
end;
$$;

revoke execute on function public.fn_create_payment(uuid, text, date, text, text, numeric, text, jsonb) from public, anon;
revoke execute on function public.fn_allocate_payment(uuid, jsonb) from public, anon;
revoke execute on function public.fn_cancel_payment(uuid, text) from public, anon;

grant execute on function public.fn_create_payment(uuid, text, date, text, text, numeric, text, jsonb) to authenticated;
grant execute on function public.fn_allocate_payment(uuid, jsonb) to authenticated;
grant execute on function public.fn_cancel_payment(uuid, text) to authenticated;
