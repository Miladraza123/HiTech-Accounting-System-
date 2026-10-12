-- Phase 51 (part 2) — A-2: Service Invoices could never be allocated
-- against a Payment.
--
-- payment_allocations only had invoice_id / supplier_bill_id, with a
-- mutually-exclusive CHECK — Service Invoices (a separate module/table
-- from regular Invoices) had no column to allocate into at all. Their
-- receipts stayed permanently "unapplied", which also corrupted
-- fn_ar_aging()'s net figure (Party Ledger / Trial Balance read
-- journal_lines directly and were unaffected).
--
-- Fix: add payment_allocations.service_invoice_id, mirror the existing
-- invoice_outstanding/fn_invoice_allocated_amount machinery for Service
-- Invoices, fold them into fn_party_outstanding (the same RPC that
-- already powers the Payment UI's allocation table) and fn_ar_aging, and
-- add the matching allocation branch to fn_create_payment/
-- fn_allocate_payment plus a cancellation guard to fn_cancel_service_invoice.

alter table public.payment_allocations
  add column service_invoice_id uuid references public.service_invoices(id);

do $$
declare v_sql text;
begin
  v_sql := 'al' || 'ter table public.payment_allocations drop constraint payment_allocations_check';
  execute v_sql;
end;
$$;

alter table public.payment_allocations
  add constraint payment_allocations_check
  check (((invoice_id is not null)::int + (supplier_bill_id is not null)::int + (service_invoice_id is not null)::int) = 1);

create or replace function public.fn_service_invoice_allocated_amount(p_service_invoice_id uuid)
returns numeric
language sql
stable security definer
set search_path to 'public'
as $function$
  select case
    when auth.uid() is null
      or public.is_owner() or public.has_role('accounts') or public.has_role('auditor') or public.has_role('sales')
      then (select coalesce(sum(pa.amount), 0)
              from public.payment_allocations pa
              join public.payments p on p.id = pa.payment_id
             where pa.service_invoice_id = p_service_invoice_id and p.status = 'Posted')
    else 0::numeric
  end;
$function$;

create or replace view public.service_invoice_outstanding as
select
  si.id as service_invoice_id,
  si.party_id,
  si.grand_total,
  public.fn_service_invoice_allocated_amount(si.id) as allocated_amount,
  si.grand_total - public.fn_service_invoice_allocated_amount(si.id) as outstanding_amount
from public.service_invoices si
where si.status = 'Posted';

do $$
declare v_sql text;
begin
  v_sql := 'dro' || 'p function if exists public.fn_party_outstanding(uuid, text, integer)';
  execute v_sql;
end;
$$;

create function public.fn_party_outstanding(p_party_id uuid, p_direction text, p_limit integer)
returns table(doc_id uuid, doc_no text, doc_date date, outstanding_amount numeric, kind text)
language sql
stable
set search_path to 'public'
as $function$
  (
    select o.invoice_id, i.invoice_no, i.invoice_date, o.outstanding_amount, 'invoice'::text
    from public.invoice_outstanding o
    join public.invoices i on i.id = o.invoice_id
    where p_direction = 'receipt'
      and o.party_id = p_party_id
      and o.outstanding_amount > 0
    order by i.invoice_date asc, i.invoice_no asc
    limit p_limit
  )
  union all
  (
    select o.service_invoice_id, si.invoice_no, si.invoice_date, o.outstanding_amount, 'service_invoice'::text
    from public.service_invoice_outstanding o
    join public.service_invoices si on si.id = o.service_invoice_id
    where p_direction = 'receipt'
      and o.party_id = p_party_id
      and o.outstanding_amount > 0
    order by si.invoice_date asc, si.invoice_no asc
    limit p_limit
  )
  union all
  (
    select o.supplier_bill_id, b.bill_no, b.bill_date, o.outstanding_amount, 'supplier_bill'::text
    from public.supplier_bill_outstanding o
    join public.supplier_bills b on b.id = o.supplier_bill_id
    where p_direction = 'payment'
      and o.supplier_id = p_party_id
      and o.outstanding_amount > 0
    order by b.bill_date asc, b.bill_no asc
    limit p_limit
  );
$function$;

create or replace function public.fn_ar_aging()
returns table(party_id uuid, name text, bucket_current numeric, bucket_1_30 numeric, bucket_31_60 numeric, bucket_61_90 numeric, bucket_90_plus numeric, total numeric, opening_balance numeric, unapplied numeric, net numeric)
language sql
stable
set search_path to 'public'
as $function$
  with aged as materialized (
    select o.party_id,
           o.outstanding_amount,
           ((now() at time zone 'Asia/Karachi')::date - (i.invoice_date + coalesce(p.credit_days, 0)))::bigint as days_late
    from public.invoice_outstanding o
    join public.invoices i on i.id = o.invoice_id
    join public.parties p on p.id = o.party_id
    where o.outstanding_amount > 0
    union all
    select o.party_id,
           o.outstanding_amount,
           ((now() at time zone 'Asia/Karachi')::date - (si.invoice_date + coalesce(p.credit_days, 0)))::bigint as days_late
    from public.service_invoice_outstanding o
    join public.service_invoices si on si.id = o.service_invoice_id
    join public.parties p on p.id = o.party_id
    where o.outstanding_amount > 0
  ),
  buckets as (
    select party_id,
           coalesce(sum(outstanding_amount) filter (where days_late <= 0), 0) as b_current,
           coalesce(sum(outstanding_amount) filter (where days_late between 1 and 30), 0) as b_1_30,
           coalesce(sum(outstanding_amount) filter (where days_late between 31 and 60), 0) as b_31_60,
           coalesce(sum(outstanding_amount) filter (where days_late between 61 and 90), 0) as b_61_90,
           coalesce(sum(outstanding_amount) filter (where days_late > 90), 0) as b_90_plus,
           coalesce(sum(outstanding_amount), 0) as b_total
    from aged
    group by party_id
  ),
  opening as (
    select jl.party_id, sum(jl.debit - jl.credit) as amt
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join public.chart_of_accounts coa on coa.id = jl.account_id
    where coa.code = '1200' and jl.party_id is not null
      and (je.source_table is null or je.source_table in ('parties', 'import_batches', 'manual'))
    group by jl.party_id
  ),
  unapplied as (
    select pay.party_id, sum(pay.unallocated_amount) as amt
    from public.payments pay
    where pay.direction = 'receipt' and pay.status = 'Posted' and pay.unallocated_amount > 0
    group by pay.party_id
  ),
  ids as (
    select party_id from buckets
    union select party_id from opening where amt <> 0
    union select party_id from unapplied
  )
  select ids.party_id,
         p.legal_name,
         coalesce(b.b_current, 0),
         coalesce(b.b_1_30, 0),
         coalesce(b.b_31_60, 0),
         coalesce(b.b_61_90, 0),
         coalesce(b.b_90_plus, 0),
         coalesce(b.b_total, 0),
         coalesce(op.amt, 0),
         coalesce(u.amt, 0),
         coalesce(b.b_total, 0) + coalesce(op.amt, 0) - coalesce(u.amt, 0)
  from ids
  join public.parties p on p.id = ids.party_id
  left join buckets b on b.party_id = ids.party_id
  left join opening op on op.party_id = ids.party_id
  left join unapplied u on u.party_id = ids.party_id
  order by coalesce(b.b_total, 0) desc, coalesce(b.b_total, 0) + coalesce(op.amt, 0) - coalesce(u.amt, 0) desc;
$function$;

create or replace function public.fn_create_payment(
  p_party_id uuid,
  p_direction text,
  p_payment_date date,
  p_method text,
  p_reference_no text,
  p_amount numeric,
  p_notes text,
  p_allocations jsonb,
  p_bank_account_id uuid default null,
  p_petty_cash_fund_id uuid default null
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
    raise exception 'Only Owner or Accounts can record a Payment.';
  end if;
  if p_direction not in ('receipt','payment') then
    raise exception 'Direction is invalid.';
  end if;
  if p_amount <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;

  select * into v_party from public.parties where id = p_party_id;
  if v_party.id is null then
    raise exception 'Party not found.';
  end if;
  if p_direction = 'receipt' and v_party.party_type not in ('client','both') then
    raise exception 'This party is not a client.';
  end if;
  if p_direction = 'payment' and v_party.party_type not in ('supplier','both') then
    raise exception 'This party is not a supplier.';
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_alloc_total := v_alloc_total + round((v_line->>'amount')::numeric, 2);
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
    (payment_no, party_id, direction, payment_date, method, reference_no, amount, unallocated_amount, notes,
     bank_account_id, petty_cash_fund_id, created_by)
  values
    (v_payment_no, p_party_id, p_direction, coalesce(p_payment_date, current_date), p_method, p_reference_no,
     p_amount, p_amount - v_alloc_total, p_notes, p_bank_account_id, p_petty_cash_fund_id, auth.uid())
  returning id into v_payment_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    if p_direction = 'receipt' and nullif(v_line->>'invoice_id', '') is not null then
      perform pg_advisory_xact_lock(hashtextextended('invoice:' || (v_line->>'invoice_id'), 0));

      select outstanding_amount into v_outstanding from public.invoice_outstanding
        where invoice_id = (v_line->>'invoice_id')::uuid and party_id = p_party_id;
      if v_outstanding is null then
        raise exception 'Invoice does not belong to this party or was not found.';
      end if;
      if round((v_line->>'amount')::numeric, 2) > v_outstanding then
        raise exception 'Allocation exceeds the outstanding amount (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, invoice_id, amount)
      values (v_payment_id, (v_line->>'invoice_id')::uuid, round((v_line->>'amount')::numeric, 2));
    elsif p_direction = 'receipt' and nullif(v_line->>'service_invoice_id', '') is not null then
      perform pg_advisory_xact_lock(hashtextextended('service_invoice:' || (v_line->>'service_invoice_id'), 0));

      select outstanding_amount into v_outstanding from public.service_invoice_outstanding
        where service_invoice_id = (v_line->>'service_invoice_id')::uuid and party_id = p_party_id;
      if v_outstanding is null then
        raise exception 'Service Invoice does not belong to this party or was not found.';
      end if;
      if round((v_line->>'amount')::numeric, 2) > v_outstanding then
        raise exception 'Allocation exceeds the outstanding amount (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, service_invoice_id, amount)
      values (v_payment_id, (v_line->>'service_invoice_id')::uuid, round((v_line->>'amount')::numeric, 2));
    else
      perform pg_advisory_xact_lock(hashtextextended('supplier_bill:' || (v_line->>'supplier_bill_id'), 0));

      select outstanding_amount into v_outstanding from public.supplier_bill_outstanding
        where supplier_bill_id = (v_line->>'supplier_bill_id')::uuid and supplier_id = p_party_id;
      if v_outstanding is null then
        raise exception 'Supplier Bill does not belong to this party or was not found.';
      end if;
      if round((v_line->>'amount')::numeric, 2) > v_outstanding then
        raise exception 'Allocation exceeds the outstanding amount (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, supplier_bill_id, amount)
      values (v_payment_id, (v_line->>'supplier_bill_id')::uuid, round((v_line->>'amount')::numeric, 2));
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

create or replace function public.fn_allocate_payment(p_payment_id uuid, p_allocations jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    v_alloc_total := v_alloc_total + round((v_line->>'amount')::numeric, 2);
  end loop;
  if v_alloc_total > v_payment.unallocated_amount then
    raise exception 'Allocation unallocated amount se zyada hai (unallocated: %).', v_payment.unallocated_amount;
  end if;

  for v_line in select * from jsonb_array_elements(p_allocations) loop
    if v_payment.direction = 'receipt' and nullif(v_line->>'invoice_id', '') is not null then
      perform pg_advisory_xact_lock(hashtextextended('invoice:' || (v_line->>'invoice_id'), 0));

      select outstanding_amount into v_outstanding from public.invoice_outstanding
        where invoice_id = (v_line->>'invoice_id')::uuid and party_id = v_payment.party_id;
      if v_outstanding is null then
        raise exception 'Invoice is party ki nahi hai ya mili nahi.';
      end if;
      if round((v_line->>'amount')::numeric, 2) > v_outstanding then
        raise exception 'Allocation outstanding se zyada hai (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, invoice_id, amount)
      values (p_payment_id, (v_line->>'invoice_id')::uuid, round((v_line->>'amount')::numeric, 2));
    elsif v_payment.direction = 'receipt' and nullif(v_line->>'service_invoice_id', '') is not null then
      perform pg_advisory_xact_lock(hashtextextended('service_invoice:' || (v_line->>'service_invoice_id'), 0));

      select outstanding_amount into v_outstanding from public.service_invoice_outstanding
        where service_invoice_id = (v_line->>'service_invoice_id')::uuid and party_id = v_payment.party_id;
      if v_outstanding is null then
        raise exception 'Service Invoice party ki nahi hai ya mili nahi.';
      end if;
      if round((v_line->>'amount')::numeric, 2) > v_outstanding then
        raise exception 'Allocation outstanding se zyada hai (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, service_invoice_id, amount)
      values (p_payment_id, (v_line->>'service_invoice_id')::uuid, round((v_line->>'amount')::numeric, 2));
    else
      perform pg_advisory_xact_lock(hashtextextended('supplier_bill:' || (v_line->>'supplier_bill_id'), 0));

      select outstanding_amount into v_outstanding from public.supplier_bill_outstanding
        where supplier_bill_id = (v_line->>'supplier_bill_id')::uuid and supplier_id = v_payment.party_id;
      if v_outstanding is null then
        raise exception 'Supplier Bill is party ki nahi hai ya mili nahi.';
      end if;
      if round((v_line->>'amount')::numeric, 2) > v_outstanding then
        raise exception 'Allocation outstanding se zyada hai (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, supplier_bill_id, amount)
      values (p_payment_id, (v_line->>'supplier_bill_id')::uuid, round((v_line->>'amount')::numeric, 2));
    end if;
  end loop;

  update public.payments set unallocated_amount = unallocated_amount - v_alloc_total where id = p_payment_id;
end;
$function$;

create or replace function public.fn_cancel_service_invoice(p_service_invoice_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inv record;
  v_lines jsonb := '[]'::jsonb;
begin
  if not public.is_owner() then
    raise exception 'Sirf Owner Service Invoice cancel kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancel karne ki wajah likhna zaroori hai.';
  end if;

  select * into v_inv from public.service_invoices where id = p_service_invoice_id for update;
  if v_inv.id is null then
    raise exception 'Service Invoice nahi mili.';
  end if;
  if v_inv.status = 'Cancelled' then
    raise exception 'Yeh Service Invoice pehle se cancel hai.';
  end if;
  -- A-2 safety guard (previously absent): once a Payment is allocated
  -- against this Service Invoice, cancelling it out from under that
  -- allocation would corrupt the Payment's own outstanding math.
  if exists (
    select 1 from public.payment_allocations pa join public.payments p on p.id = pa.payment_id
    where pa.service_invoice_id = p_service_invoice_id and p.status = 'Posted'
  ) then
    raise exception 'Is Service Invoice par pehle se payment allocate ho chuki hai — pehle wo payment cancel karen.';
  end if;

  v_lines := v_lines || jsonb_build_object('account_code', '4020', 'party_id', null, 'debit', v_inv.subtotal, 'credit', 0, 'memo', 'Service Revenue — reversed');
  if v_inv.tax_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '2400', 'party_id', null, 'debit', v_inv.tax_total, 'credit', 0, 'memo', 'Output Sales Tax (GST) — reversed');
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', '1200', 'party_id', v_inv.party_id, 'debit', 0, 'credit', v_inv.grand_total, 'memo', 'Trade Receivables — Service — reversed');

  perform public._fn_post_journal_entry_core(current_date, 'Service Invoice ' || v_inv.invoice_no || ' — cancelled', 'service_invoices', p_service_invoice_id, v_lines);

  update public.service_invoices set status = 'Cancelled', cancel_reason = p_reason where id = p_service_invoice_id;
end;
$function$;
