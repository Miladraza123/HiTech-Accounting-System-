alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.grns enable row level security;
alter table public.grn_lines enable row level security;
alter table public.stock_ledger enable row level security;
alter table public.stock_adjustments enable row level security;

-- Purchase Orders & lines: everyone reads (View, per the permission
-- matrix); Owner + Store write. Actual mutation goes through
-- fn_create_purchase_order / fn_cancel_purchase_order.
create policy p_select on public.purchase_orders for select to authenticated using (true);
create policy p_insert on public.purchase_orders for insert to authenticated
  with check (public.is_owner() or public.has_role('store'));
create policy p_update on public.purchase_orders for update to authenticated
  using (public.is_owner() or public.has_role('store'))
  with check (public.is_owner() or public.has_role('store'));
create policy p_delete on public.purchase_orders for delete to authenticated using (public.is_owner());

create policy p_select on public.purchase_order_lines for select to authenticated using (true);
create policy p_insert on public.purchase_order_lines for insert to authenticated
  with check (public.is_owner() or public.has_role('store'));
create policy p_update on public.purchase_order_lines for update to authenticated
  using (public.is_owner() or public.has_role('store'))
  with check (public.is_owner() or public.has_role('store'));
create policy p_delete on public.purchase_order_lines for delete to authenticated
  using (public.is_owner() or public.has_role('store'));

-- GRN: everyone reads; Owner + Store write, via fn_create_grn only in
-- practice (the function itself re-checks role).
create policy p_select on public.grns for select to authenticated using (true);
create policy p_insert on public.grns for insert to authenticated
  with check (public.is_owner() or public.has_role('store'));

create policy p_select on public.grn_lines for select to authenticated using (true);
create policy p_insert on public.grn_lines for insert to authenticated
  with check (public.is_owner() or public.has_role('store'));

-- Stock ledger: everyone reads (Store/Production/Accounts all need
-- visibility); nobody writes directly — only _fn_post_stock_ledger
-- (SECURITY DEFINER) may insert.
create policy p_select on public.stock_ledger for select to authenticated using (true);

-- Stock adjustments: everyone reads; Owner + Store may request one;
-- only the approve/reject functions (Owner-only, SECURITY DEFINER)
-- change status — no update policy is granted here on purpose.
create policy p_select on public.stock_adjustments for select to authenticated using (true);
create policy p_insert on public.stock_adjustments for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and (public.is_owner() or public.has_role('store'))
  );
