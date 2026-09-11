-- Missing covering indexes on foreign keys
create index idx_attachments_uploaded_by on public.attachments(uploaded_by);
create index idx_coa_parent on public.chart_of_accounts(parent_id);
create index idx_company_province on public.company(province);
create index idx_import_batches_uploaded_by on public.import_batches(uploaded_by);
create index idx_items_base_unit on public.items(base_unit);
create index idx_journal_entries_created_by on public.journal_entries(created_by);
create index idx_parties_created_by on public.parties(created_by);
create index idx_parties_province on public.parties(province);
create index idx_parties_updated_by on public.parties(updated_by);
create index idx_unit_conversions_to_unit on public.unit_conversions(to_unit);
create index idx_user_roles_assigned_by on public.user_roles(assigned_by);
create index idx_user_roles_role on public.user_roles(role_id);

-- Re-evaluate auth.uid() once per query, not once per row
drop policy p_update on public.profiles;
create policy p_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or public.is_owner())
  with check (id = (select auth.uid()) or public.is_owner());

drop policy p_select on public.user_roles;
create policy p_select on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or public.is_owner());

drop policy p_insert on public.attachments;
create policy p_insert on public.attachments for insert to authenticated
  with check (uploaded_by = (select auth.uid()));

drop policy p_delete on public.attachments;
create policy p_delete on public.attachments for delete to authenticated
  using (uploaded_by = (select auth.uid()) or public.is_owner());

drop policy p_select on public.login_sessions;
create policy p_select on public.login_sessions for select to authenticated
  using (user_id = (select auth.uid()) or public.is_owner() or public.has_role('auditor'));

-- Split every "for all" write policy into insert/update/delete so SELECT
-- only ever evaluates one permissive policy instead of two
drop policy p_write on public.roles;
create policy p_insert on public.roles for insert to authenticated with check (public.is_owner());
create policy p_update on public.roles for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy p_delete on public.roles for delete to authenticated using (public.is_owner());

drop policy p_write on public.user_roles;
create policy p_insert on public.user_roles for insert to authenticated with check (public.is_owner());
create policy p_update on public.user_roles for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy p_delete on public.user_roles for delete to authenticated using (public.is_owner());

drop policy p_write on public.company;
create policy p_insert on public.company for insert to authenticated with check (public.is_owner());
create policy p_update on public.company for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy p_delete on public.company for delete to authenticated using (public.is_owner());

drop policy p_write on public.warehouses;
create policy p_insert on public.warehouses for insert to authenticated with check (public.is_owner() or public.has_role('store'));
create policy p_update on public.warehouses for update to authenticated using (public.is_owner() or public.has_role('store')) with check (public.is_owner() or public.has_role('store'));
create policy p_delete on public.warehouses for delete to authenticated using (public.is_owner());

drop policy p_write on public.numbering_sequences;
create policy p_insert on public.numbering_sequences for insert to authenticated with check (public.is_owner());
create policy p_update on public.numbering_sequences for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy p_delete on public.numbering_sequences for delete to authenticated using (public.is_owner());

drop policy p_write on public.units;
create policy p_insert on public.units for insert to authenticated with check (public.is_owner());
create policy p_update on public.units for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy p_delete on public.units for delete to authenticated using (public.is_owner());

drop policy p_write on public.unit_conversions;
create policy p_insert on public.unit_conversions for insert to authenticated with check (public.is_owner());
create policy p_update on public.unit_conversions for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy p_delete on public.unit_conversions for delete to authenticated using (public.is_owner());

drop policy p_write on public.items;
create policy p_insert on public.items for insert to authenticated with check (public.is_owner() or public.has_role('store') or public.has_role('production'));
create policy p_update on public.items for update to authenticated using (public.is_owner() or public.has_role('store') or public.has_role('production')) with check (public.is_owner() or public.has_role('store') or public.has_role('production'));
create policy p_delete on public.items for delete to authenticated using (public.is_owner());

drop policy p_write on public.parties;
create policy p_insert on public.parties for insert to authenticated with check (public.is_owner() or public.has_role('sales') or public.has_role('store'));
create policy p_update on public.parties for update to authenticated using (public.is_owner() or public.has_role('sales') or public.has_role('store')) with check (public.is_owner() or public.has_role('sales') or public.has_role('store'));
create policy p_delete on public.parties for delete to authenticated using (public.is_owner());

drop policy p_write on public.party_contacts;
create policy p_insert on public.party_contacts for insert to authenticated with check (public.is_owner() or public.has_role('sales') or public.has_role('store'));
create policy p_update on public.party_contacts for update to authenticated using (public.is_owner() or public.has_role('sales') or public.has_role('store')) with check (public.is_owner() or public.has_role('sales') or public.has_role('store'));
create policy p_delete on public.party_contacts for delete to authenticated using (public.is_owner());

drop policy p_write on public.chart_of_accounts;
create policy p_insert on public.chart_of_accounts for insert to authenticated with check (public.is_owner());
create policy p_update on public.chart_of_accounts for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy p_delete on public.chart_of_accounts for delete to authenticated using (public.is_owner());

drop policy p_write on public.import_batches;
create policy p_insert on public.import_batches for insert to authenticated with check (public.is_owner() or public.has_role('accounts'));
create policy p_update on public.import_batches for update to authenticated using (public.is_owner() or public.has_role('accounts')) with check (public.is_owner() or public.has_role('accounts'));
create policy p_delete on public.import_batches for delete to authenticated using (public.is_owner());
