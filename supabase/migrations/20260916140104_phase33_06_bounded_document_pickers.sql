-- Phase 33.06 — /invoices/new and /delivery-challans/new stop building a
-- request out of the entire eligible set
--
-- Phase 31.10 moved the eligibility test into the database, which was right,
-- but both pages still take the FULL id list it returns and feed it straight
-- back as a PostgREST `.in("id", ids)` filter. That filter travels in the
-- query string of a GET, so the request grows with the eligible set: on the
-- loaded branch fn_invoiceable_sales_order_ids returns 70,000 ids and
-- fn_deliverable_sales_order_ids 60,000, which is a URL of roughly 2.6 MB.
-- Long before that it stops being slow and starts being rejected outright --
-- no invoice and no delivery challan can be created at all.
--
-- That cliff arrives at a few hundred eligible documents, not at 70,000, so it
-- is not really a "volume" problem: any backlog of un-invoiced deliveries can
-- reach it. These return one page of the eligible set, newest first, with the
-- eligible total alongside, so the request size is fixed no matter how large
-- the backlog gets. p_search matches the SO number, the client PO number or
-- the client name, so an older eligible order is still reachable.
--
-- The eligibility rules themselves are copied unchanged from Phase 31.10 --
-- a Sales Order is invoiceable while any line has invoiced_qty <
-- delivered_qty, and deliverable while any line has delivered_qty <
-- ordered_qty, in both cases only while the order is neither Cancelled nor
-- Closed. security invoker, as before, so RLS is unchanged.

create or replace function public.fn_invoiceable_sales_orders_page(
  p_search text,
  p_limit integer,
  p_offset integer
)
returns table (id uuid, total_rows bigint)
language sql
security invoker
stable
set search_path to 'public'
as $function$
  with eligible as materialized (
    select distinct so.id, so.created_at
    from public.sales_orders so
    join public.sales_order_lines l on l.sales_order_id = so.id
    left join public.parties p on p.id = so.party_id
    where so.status not in ('Cancelled', 'Closed')
      and l.invoiced_qty < l.delivered_qty
      and (
        p_search is null or p_search = ''
        or so.so_no ilike '%' || p_search || '%'
        or so.client_po_number ilike '%' || p_search || '%'
        or p.legal_name ilike '%' || p_search || '%'
      )
  )
  select e.id, (select count(*) from eligible) as total_rows
  from eligible e
  order by e.created_at desc, e.id
  offset p_offset
  limit p_limit;
$function$;

grant execute on function public.fn_invoiceable_sales_orders_page(text, integer, integer) to authenticated;

create or replace function public.fn_deliverable_sales_orders_page(
  p_search text,
  p_limit integer,
  p_offset integer
)
returns table (id uuid, total_rows bigint)
language sql
security invoker
stable
set search_path to 'public'
as $function$
  with eligible as materialized (
    select distinct so.id, so.created_at
    from public.sales_orders so
    join public.sales_order_lines l on l.sales_order_id = so.id
    left join public.parties p on p.id = so.party_id
    where so.status not in ('Cancelled', 'Closed')
      and l.delivered_qty < l.ordered_qty
      and (
        p_search is null or p_search = ''
        or so.so_no ilike '%' || p_search || '%'
        or so.client_po_number ilike '%' || p_search || '%'
        or p.legal_name ilike '%' || p_search || '%'
      )
  )
  select e.id, (select count(*) from eligible) as total_rows
  from eligible e
  order by e.created_at desc, e.id
  offset p_offset
  limit p_limit;
$function$;

grant execute on function public.fn_deliverable_sales_orders_page(text, integer, integer) to authenticated;

-- fn_invoiceable_sales_order_ids() and fn_deliverable_sales_order_ids() are
-- deliberately left in place: they are still the plain statement of the
-- eligibility rule, still correct, and cheap to call when the caller wants the
-- whole set rather than a request-sized slice of it.
