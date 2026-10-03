-- Phase 39.01 — "which supplier did we last buy this item from, and at what
-- rate" lookup.
--
-- There is no RFQ/PR table in this schema — Purchase starts directly at the
-- Purchase Order — so this reads straight off purchase_order_lines, which
-- already carries a real item_id FK for any line created against a catalog
-- item (free-text-only lines, with item_id null, are simply excluded).
--
-- security invoker (the default): a caller sees exactly the purchase history
-- RLS on purchase_order_lines/purchase_orders/parties would already let them
-- see by querying those tables directly — this just does the join+order/limit
-- server-side instead of shipping every historical line to the browser.
create or replace function public.fn_item_purchase_history(
  p_item_id uuid,
  p_limit integer default 3
)
returns table (po_id uuid, po_no text, po_date date, supplier_name text, rate numeric)
language sql
security invoker
stable
set search_path to 'public'
as $function$
  select po.id, po.po_no, po.created_at::date, p.legal_name, pol.rate
  from public.purchase_order_lines pol
  join public.purchase_orders po on po.id = pol.purchase_order_id
  join public.parties p on p.id = po.supplier_id
  where pol.item_id = p_item_id
  order by po.created_at desc
  limit p_limit;
$function$;

grant execute on function public.fn_item_purchase_history(uuid, integer) to authenticated;
