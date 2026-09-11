alter table public.query_sources enable row level security;
alter table public.activity_timeline enable row level security;
alter table public.queries enable row level security;
alter table public.quotations enable row level security;
alter table public.quotation_revisions enable row level security;
alter table public.quotation_lines enable row level security;

create policy p_select on public.query_sources for select to authenticated using (true);
create policy p_insert on public.query_sources for insert to authenticated with check (public.is_owner());
create policy p_update on public.query_sources for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy p_delete on public.query_sources for delete to authenticated using (public.is_owner());

-- Activity feed: anyone signed in can read and add their own note; append-only
create policy p_select on public.activity_timeline for select to authenticated using (true);
create policy p_insert on public.activity_timeline for insert to authenticated
  with check (actor_id = (select auth.uid()));

-- Queries: everyone reads (View per the permission matrix); Owner + Sales write
create policy p_select on public.queries for select to authenticated using (true);
create policy p_insert on public.queries for insert to authenticated
  with check (public.is_owner() or public.has_role('sales'));
create policy p_update on public.queries for update to authenticated
  using (public.is_owner() or public.has_role('sales'))
  with check (public.is_owner() or public.has_role('sales'));
create policy p_delete on public.queries for delete to authenticated using (public.is_owner());

create policy p_select on public.quotations for select to authenticated using (true);
create policy p_insert on public.quotations for insert to authenticated
  with check (public.is_owner() or public.has_role('sales'));
create policy p_update on public.quotations for update to authenticated
  using (public.is_owner() or public.has_role('sales'))
  with check (public.is_owner() or public.has_role('sales'));
create policy p_delete on public.quotations for delete to authenticated using (public.is_owner());

create policy p_select on public.quotation_revisions for select to authenticated using (true);
create policy p_insert on public.quotation_revisions for insert to authenticated
  with check (public.is_owner() or public.has_role('sales'));
create policy p_update on public.quotation_revisions for update to authenticated
  using (public.is_owner() or public.has_role('sales'))
  with check (public.is_owner() or public.has_role('sales'));
create policy p_delete on public.quotation_revisions for delete to authenticated using (public.is_owner());

create policy p_select on public.quotation_lines for select to authenticated using (true);
create policy p_insert on public.quotation_lines for insert to authenticated
  with check (public.is_owner() or public.has_role('sales'));
create policy p_update on public.quotation_lines for update to authenticated
  using (public.is_owner() or public.has_role('sales'))
  with check (public.is_owner() or public.has_role('sales'));
create policy p_delete on public.quotation_lines for delete to authenticated using (public.is_owner() or public.has_role('sales'));
