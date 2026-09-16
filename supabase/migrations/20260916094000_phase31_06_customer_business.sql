-- Phase 31.06 — Report performance, part 5: customer-wise business
--
-- /reports/customer-business fetched every non-cancelled sales order, every
-- invoice and every invoice_outstanding row, then grouped them per client in
-- JavaScript. The rendered result is one row per client — bounded by the
-- customer list — but three of the four inputs grow with every transaction
-- the business ever makes. The Excel export carried a second copy of the same
-- logic; it now calls this function too, so the two cannot drift apart.
--
-- Equivalence notes:
--  * the old query used PostgREST .not('status','eq','Cancelled'), which is
--    NOT (status = 'Cancelled') and therefore also drops NULL status, exactly
--    like `status <> 'Cancelled'` here;
--  * invoiced counts only status = 'Posted', as the JS loop did;
--  * outstanding sums every invoice_outstanding row for the party with no
--    threshold, as the JS loop did;
--  * clients with no orders were filtered out (orderCount > 0) — the inner
--    join reproduces that — and the list was sorted by order value desc.
--
-- security invoker: same RLS as the .select() calls it replaces.
create or replace function public.fn_customer_business()
returns table (
  party_id uuid,
  name text,
  order_count bigint,
  order_value numeric,
  last_order_date timestamptz,
  invoiced numeric,
  outstanding numeric
)
language sql
security invoker
stable
as $$
  select p.id,
         p.legal_name,
         coalesce(so.cnt, 0)::bigint,
         coalesce(so.total, 0),
         so.last_date,
         coalesce(inv.invoiced, 0),
         coalesce(o.outstanding, 0)
  from public.parties p
  join (
    select party_id, count(*) as cnt, sum(grand_total) as total, max(created_at) as last_date
    from public.sales_orders
    where status <> 'Cancelled'
    group by party_id
  ) so on so.party_id = p.id
  left join (
    select party_id, sum(grand_total) as invoiced
    from public.invoices
    where status = 'Posted'
    group by party_id
  ) inv on inv.party_id = p.id
  left join (
    select party_id, sum(outstanding_amount) as outstanding
    from public.invoice_outstanding
    where party_id is not null
    group by party_id
  ) o on o.party_id = p.id
  where p.party_type in ('client', 'both')
  order by coalesce(so.total, 0) desc;
$$;

grant execute on function public.fn_customer_business() to authenticated;
