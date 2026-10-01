-- phase38_04's allocated-amount helpers returned 0 when there is no signed-in
-- user (service role, Backup Bot, SQL run by maintenance), because is_owner()
-- is false there — which would inflate outstanding for those callers. Treat
-- auth.uid() is null as internal; anon cannot execute these (revoked in 04).
create or replace function public.fn_invoice_allocated_amount(p_invoice_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null
      or public.is_owner() or public.has_role('accounts') or public.has_role('auditor') or public.has_role('sales')
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
    when auth.uid() is null
      or public.is_owner() or public.has_role('accounts') or public.has_role('auditor') or public.has_role('store')
      then (select coalesce(sum(pa.amount), 0)
              from public.payment_allocations pa
              join public.payments p on p.id = pa.payment_id
             where pa.supplier_bill_id = p_supplier_bill_id and p.status = 'Posted')
    else 0::numeric
  end;
$$;
