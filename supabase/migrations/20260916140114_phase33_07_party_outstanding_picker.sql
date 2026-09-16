-- Phase 33.07 — /payments/new stops downloading every outstanding document
--
-- The New Payment screen loaded the whole invoice_outstanding view and the
-- whole supplier_bill_outstanding view, then filtered them in the browser down
-- to the one party the payment is for. On the loaded branch that is 118,763
-- rows and 22 MB of JSON, sent on every visit to the page, to show a handful
-- of allocation lines.
--
-- This returns the outstanding documents of ONE party, oldest first (which is
-- the order they should be settled in), bounded by p_limit. The document
-- number and date come back in the same call, so the page no longer needs a
-- second round trip to name the rows it just fetched.
--
-- security invoker (the default), so a caller sees exactly the outstanding
-- documents RLS would have shown them through the views directly.
--
-- p_direction mirrors the screen's own toggle: 'receipt' settles this client's
-- invoices, 'payment' settles this supplier's bills. Any other value returns
-- nothing rather than guessing.
create or replace function public.fn_party_outstanding(
  p_party_id uuid,
  p_direction text,
  p_limit integer
)
returns table (doc_id uuid, doc_no text, doc_date date, outstanding_amount numeric)
language sql
security invoker
stable
set search_path to 'public'
as $function$
  (
    select o.invoice_id, i.invoice_no, i.invoice_date, o.outstanding_amount
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
    select o.supplier_bill_id, b.bill_no, b.bill_date, o.outstanding_amount
    from public.supplier_bill_outstanding o
    join public.supplier_bills b on b.id = o.supplier_bill_id
    where p_direction = 'payment'
      and o.supplier_id = p_party_id
      and o.outstanding_amount > 0
    order by b.bill_date asc, b.bill_no asc
    limit p_limit
  );
$function$;

grant execute on function public.fn_party_outstanding(uuid, text, integer) to authenticated;
