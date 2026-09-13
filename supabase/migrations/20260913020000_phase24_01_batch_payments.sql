-- Phase 24: record several payments/receipts in one go from the Payments
-- module (e.g. several customer cheques collected the same day).
--
-- This does NOT duplicate fn_create_payment's validation, numbering, or
-- journal-posting logic — it calls that existing function once per row,
-- inside a single plpgsql call. Because the whole batch runs as one
-- Postgres function invocation, it is naturally all-or-nothing: if any
-- row fails validation, the exception aborts the entire transaction and
-- none of the rows are posted (no partial batch, no partially-updated
-- ledger). The failing row's position and reason are reported back so
-- the user can fix just that row and resubmit the whole batch.
--
-- Bill-wise allocation is intentionally left out of the batch shape
-- (each row is created the same way an unallocated/"on account" single
-- payment already can be) — the existing Allocate panel on a payment's
-- own detail page (AllocatePaymentPanel.tsx / fn_allocate_payment) is
-- reused afterward for that, rather than building a second allocation
-- UI inside a multi-row grid.
create or replace function public.fn_create_payments_batch(p_payments jsonb)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_payment jsonb;
  v_results jsonb := '[]'::jsonb;
  v_id uuid;
  v_payment_no text;
  v_index int := 0;
begin
  if p_payments is null or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then
    raise exception 'Add at least one payment row.';
  end if;
  if jsonb_array_length(p_payments) > 50 then
    raise exception 'Too many payments in one batch (max 50 at a time).';
  end if;

  for v_payment in select * from jsonb_array_elements(p_payments) loop
    v_index := v_index + 1;

    begin
      select public.fn_create_payment(
        (v_payment->>'party_id')::uuid,
        v_payment->>'direction',
        (v_payment->>'payment_date')::date,
        nullif(v_payment->>'method', ''),
        nullif(v_payment->>'reference_no', ''),
        (v_payment->>'amount')::numeric,
        nullif(v_payment->>'notes', ''),
        coalesce(v_payment->'allocations', '[]'::jsonb),
        nullif(v_payment->>'bank_account_id', '')::uuid,
        nullif(v_payment->>'petty_cash_fund_id', '')::uuid
      ) into v_id;
    exception
      when others then
        raise exception 'Row %: %', v_index, sqlerrm;
    end;

    select payment_no into v_payment_no from public.payments where id = v_id;
    v_results := v_results || jsonb_build_object('id', v_id, 'payment_no', v_payment_no);
  end loop;

  return v_results;
end;
$$;

revoke all on function public.fn_create_payments_batch(jsonb) from public, anon;
grant execute on function public.fn_create_payments_batch(jsonb) to authenticated;
