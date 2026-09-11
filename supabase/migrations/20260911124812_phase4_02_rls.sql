alter table public.product_templates enable row level security;
alter table public.product_template_lines enable row level security;
alter table public.jobs enable row level security;
alter table public.job_material_requirements enable row level security;
alter table public.stock_reservations enable row level security;
alter table public.job_cost_ledger enable row level security;

-- BOM templates: everyone reads; Owner + Production manage
create policy p_select on public.product_templates for select to authenticated using (true);
create policy p_insert on public.product_templates for insert to authenticated
  with check (public.is_owner() or public.has_role('production'));
create policy p_update on public.product_templates for update to authenticated
  using (public.is_owner() or public.has_role('production'))
  with check (public.is_owner() or public.has_role('production'));
create policy p_delete on public.product_templates for delete to authenticated using (public.is_owner());

create policy p_select on public.product_template_lines for select to authenticated using (true);
create policy p_insert on public.product_template_lines for insert to authenticated
  with check (public.is_owner() or public.has_role('production'));
create policy p_update on public.product_template_lines for update to authenticated
  using (public.is_owner() or public.has_role('production'))
  with check (public.is_owner() or public.has_role('production'));
create policy p_delete on public.product_template_lines for delete to authenticated
  using (public.is_owner() or public.has_role('production'));

-- Jobs: everyone reads (View per the permission matrix); Owner + Production
-- write. Actual mutation goes through the functions below.
create policy p_select on public.jobs for select to authenticated using (true);
create policy p_insert on public.jobs for insert to authenticated
  with check (public.is_owner() or public.has_role('production'));
create policy p_update on public.jobs for update to authenticated
  using (public.is_owner() or public.has_role('production'))
  with check (public.is_owner() or public.has_role('production'));
create policy p_delete on public.jobs for delete to authenticated using (public.is_owner());

create policy p_select on public.job_material_requirements for select to authenticated using (true);
create policy p_insert on public.job_material_requirements for insert to authenticated
  with check (public.is_owner() or public.has_role('production'));
create policy p_update on public.job_material_requirements for update to authenticated
  using (public.is_owner() or public.has_role('production'))
  with check (public.is_owner() or public.has_role('production'));

-- Reservations & material issue/return touch physical stock — Store can
-- act here too, alongside Production/Owner.
create policy p_select on public.stock_reservations for select to authenticated using (true);
create policy p_insert on public.stock_reservations for insert to authenticated
  with check (public.is_owner() or public.has_role('production') or public.has_role('store'));
create policy p_update on public.stock_reservations for update to authenticated
  using (public.is_owner() or public.has_role('production') or public.has_role('store'))
  with check (public.is_owner() or public.has_role('production') or public.has_role('store'));

create policy p_select on public.job_cost_ledger for select to authenticated using (true);
