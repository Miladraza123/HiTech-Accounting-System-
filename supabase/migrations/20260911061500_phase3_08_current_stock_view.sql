-- One row per item+warehouse: its latest stock_ledger entry. Runs with the
-- querying user's own privileges (default), so it's naturally covered by
-- stock_ledger's own "everyone reads" RLS policy — no separate policy
-- needed on the view itself.
create or replace view public.current_stock as
select distinct on (item_id, warehouse_id)
  item_id, warehouse_id, running_balance as qty_on_hand, avg_cost,
  round(running_balance * avg_cost, 2) as stock_value, created_at as as_of
from public.stock_ledger
order by item_id, warehouse_id, created_at desc, id desc;

grant select on public.current_stock to authenticated;
