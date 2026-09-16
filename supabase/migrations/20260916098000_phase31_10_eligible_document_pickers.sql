-- Phase 31.10 — Eligibility filters for the document pickers on the
-- Invoice / Delivery Challan / Supplier Bill creation screens.
--
-- Each of those pages fetched every open (or, for GRNs, every) document and
-- then worked out in JavaScript which ones could actually be used, because
-- the test compares one column against another (delivered vs invoiced,
-- delivered vs ordered) or needs an anti-join, and PostgREST can express
-- neither. So the page paid for the whole open-order book, or for every GRN
-- ever received, to offer a handful of choices.
--
-- These return just the eligible ids; the pages then fetch those documents
-- exactly as before, so the props they build are unchanged. The eligible set
-- is self-limiting — documents leave it as they get invoiced, delivered or
-- billed — unlike the sets they replace, which only ever grow.
--
-- Verified against the live database: each function returns an id set
-- identical to the JavaScript filter it replaces.
--
-- security invoker (the default): same RLS as the .select() calls they
-- support.

-- Sales Orders with delivered-but-not-yet-invoiced quantity.
create or replace function public.fn_invoiceable_sales_order_ids()
returns table (id uuid)
language sql
security invoker
stable
as $$
  select distinct so.id
  from public.sales_orders so
  join public.sales_order_lines l on l.sales_order_id = so.id
  where so.status not in ('Cancelled', 'Closed')
    and l.invoiced_qty < l.delivered_qty;
$$;

grant execute on function public.fn_invoiceable_sales_order_ids() to authenticated;

-- Sales Orders with ordered-but-not-yet-delivered quantity.
create or replace function public.fn_deliverable_sales_order_ids()
returns table (id uuid)
language sql
security invoker
stable
as $$
  select distinct so.id
  from public.sales_orders so
  join public.sales_order_lines l on l.sales_order_id = so.id
  where so.status not in ('Cancelled', 'Closed')
    and l.delivered_qty < l.ordered_qty;
$$;

grant execute on function public.fn_deliverable_sales_order_ids() to authenticated;

-- 'stock'-type GRNs that do not yet have a non-cancelled Supplier Bill.
-- ("direct"/"general" GRNs book their Trade Payables at receipt, so they
-- never need a separate bill — the same rule the page applied.)
create or replace function public.fn_unbilled_stock_grn_ids()
returns table (id uuid)
language sql
security invoker
stable
as $$
  select g.id
  from public.grns g
  join public.purchase_orders po on po.id = g.purchase_order_id
  where po.purchase_type = 'stock'
    and not exists (
      select 1 from public.supplier_bills b
      where b.grn_id = g.id and b.status <> 'Cancelled'
    );
$$;

grant execute on function public.fn_unbilled_stock_grn_ids() to authenticated;
