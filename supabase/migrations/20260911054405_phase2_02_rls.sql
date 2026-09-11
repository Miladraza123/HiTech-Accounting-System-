alter table public.sales_orders enable row level security;
alter table public.sales_order_lines enable row level security;
alter table public.sales_order_revisions enable row level security;

-- Everyone reads (View, per the permission matrix); Owner + Sales write.
-- No direct insert/update policy for sales_orders/lines beyond this —
-- in practice all writes go through fn_create_sales_order /
-- fn_amend_sales_order / fn_cancel_sales_order (SECURITY DEFINER), which
-- re-check the same role condition themselves.
create policy p_select on public.sales_orders for select to authenticated using (true);
create policy p_insert on public.sales_orders for insert to authenticated
  with check (public.is_owner() or public.has_role('sales'));
create policy p_update on public.sales_orders for update to authenticated
  using (public.is_owner() or public.has_role('sales'))
  with check (public.is_owner() or public.has_role('sales'));
create policy p_delete on public.sales_orders for delete to authenticated using (public.is_owner());

create policy p_select on public.sales_order_lines for select to authenticated using (true);
create policy p_insert on public.sales_order_lines for insert to authenticated
  with check (public.is_owner() or public.has_role('sales'));
create policy p_update on public.sales_order_lines for update to authenticated
  using (public.is_owner() or public.has_role('sales'))
  with check (public.is_owner() or public.has_role('sales'));
create policy p_delete on public.sales_order_lines for delete to authenticated
  using (public.is_owner() or public.has_role('sales'));

create policy p_select on public.sales_order_revisions for select to authenticated using (true);
create policy p_insert on public.sales_order_revisions for insert to authenticated
  with check (public.is_owner() or public.has_role('sales'));
