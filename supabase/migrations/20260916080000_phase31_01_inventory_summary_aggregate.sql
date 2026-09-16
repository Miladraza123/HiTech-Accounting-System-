-- Phase 31.01 — Inventory page performance: DB-side aggregate instead of
-- pulling every stock row into the app to reduce in JS.
--
-- /inventory previously fetched `current_stock.select("*")` and
-- `stock_availability.select("*")` in full (no .range()) on every load,
-- then computed the "combos in stock" / "total inventory value" /
-- "combos with reservation" summary cards by reducing over the whole
-- result set in Node. Harmless today (both views resolve over
-- `stock_ledger`, currently 13 rows), but `stock_ledger` grows with
-- every GRN/Delivery/Adjustment/Transfer — an unbounded transactional
-- table — so the amount of data shipped to the app on every single
-- Inventory page view would grow forever with no ceiling.
--
-- `security invoker` (the default, stated explicitly) — this must
-- respect the exact same RLS the two existing `.select("*")` calls it
-- replaces already go through; it is a query-shape optimization only,
-- never a permission change.
create or replace function public.fn_inventory_summary(p_warehouse_id uuid default null)
returns table (combo_count bigint, total_value numeric, reserved_combos bigint)
language sql
security invoker
stable
as $$
  select
    count(*)::bigint as combo_count,
    coalesce(sum(cs.stock_value), 0)::numeric as total_value,
    count(*) filter (where coalesce(rs.reserved_qty, 0) > 0)::bigint as reserved_combos
  from public.current_stock cs
  left join public.reserved_stock rs
    on rs.item_id = cs.item_id and rs.warehouse_id = cs.warehouse_id
  where cs.qty_on_hand <> 0
    and (p_warehouse_id is null or cs.warehouse_id = p_warehouse_id);
$$;

grant execute on function public.fn_inventory_summary(uuid) to authenticated;
