alter table public.provinces enable row level security;
alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.company enable row level security;
alter table public.warehouses enable row level security;
alter table public.numbering_sequences enable row level security;
alter table public.units enable row level security;
alter table public.unit_conversions enable row level security;
alter table public.items enable row level security;
alter table public.parties enable row level security;
alter table public.party_contacts enable row level security;
alter table public.chart_of_accounts enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.attachments enable row level security;
alter table public.audit_log enable row level security;
alter table public.login_sessions enable row level security;
alter table public.import_batches enable row level security;

-- provinces: public reference data
create policy p_select on public.provinces for select to authenticated using (true);

-- roles: everyone can see the role list; only Owner manages it
create policy p_select on public.roles for select to authenticated using (true);
create policy p_write on public.roles for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- profiles: everyone can see names; you (or Owner) can edit yours
create policy p_select on public.profiles for select to authenticated using (true);
create policy p_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_owner())
  with check (id = auth.uid() or public.is_owner());

-- user_roles: see your own assignments (+ Owner sees all); only Owner assigns
create policy p_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_owner());
create policy p_write on public.user_roles for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- company: everyone can read it (it prints on invoices etc.); only Owner edits
create policy p_select on public.company for select to authenticated using (true);
create policy p_write on public.company for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- warehouses: everyone reads; Owner + Store manage
create policy p_select on public.warehouses for select to authenticated using (true);
create policy p_write on public.warehouses for all to authenticated
  using (public.is_owner() or public.has_role('store'))
  with check (public.is_owner() or public.has_role('store'));

-- numbering_sequences: everyone reads (to show the next-number preview);
-- only Owner may hand-edit (normal issuance goes through fn_get_next_number,
-- which is SECURITY DEFINER and bypasses this policy)
create policy p_select on public.numbering_sequences for select to authenticated using (true);
create policy p_write on public.numbering_sequences for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- units / conversions: everyone reads; Owner manages
create policy p_select on public.units for select to authenticated using (true);
create policy p_write on public.units for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
create policy p_select on public.unit_conversions for select to authenticated using (true);
create policy p_write on public.unit_conversions for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- items: everyone reads; Owner + Store + Production manage
create policy p_select on public.items for select to authenticated using (true);
create policy p_write on public.items for all to authenticated
  using (public.is_owner() or public.has_role('store') or public.has_role('production'))
  with check (public.is_owner() or public.has_role('store') or public.has_role('production'));

-- parties: everyone reads; Owner + Sales + Store manage
create policy p_select on public.parties for select to authenticated using (true);
create policy p_write on public.parties for all to authenticated
  using (public.is_owner() or public.has_role('sales') or public.has_role('store'))
  with check (public.is_owner() or public.has_role('sales') or public.has_role('store'));

create policy p_select on public.party_contacts for select to authenticated using (true);
create policy p_write on public.party_contacts for all to authenticated
  using (public.is_owner() or public.has_role('sales') or public.has_role('store'))
  with check (public.is_owner() or public.has_role('sales') or public.has_role('store'));

-- chart_of_accounts: everyone reads; only Owner edits
create policy p_select on public.chart_of_accounts for select to authenticated using (true);
create policy p_write on public.chart_of_accounts for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- journal_entries / journal_lines: Owner + Accounts + Auditor read only.
-- No direct write policy for anyone — the only door in is
-- fn_post_journal_entry() (SECURITY DEFINER), which itself checks role.
create policy p_select on public.journal_entries for select to authenticated
  using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor'));
create policy p_select on public.journal_lines for select to authenticated
  using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor'));

-- attachments: everyone reads; anyone can attach a file they mark as their own
create policy p_select on public.attachments for select to authenticated using (true);
create policy p_insert on public.attachments for insert to authenticated
  with check (uploaded_by = auth.uid());
create policy p_delete on public.attachments for delete to authenticated
  using (uploaded_by = auth.uid() or public.is_owner());

-- audit_log: Owner + Auditor only; written solely by the trigger function
create policy p_select on public.audit_log for select to authenticated
  using (public.is_owner() or public.has_role('auditor'));

-- login_sessions: see your own; Owner + Auditor see all; written only via
-- fn_log_login / fn_log_logout
create policy p_select on public.login_sessions for select to authenticated
  using (user_id = auth.uid() or public.is_owner() or public.has_role('auditor'));

-- import_batches: Owner + Accounts
create policy p_select on public.import_batches for select to authenticated
  using (public.is_owner() or public.has_role('accounts'));
create policy p_write on public.import_batches for all to authenticated
  using (public.is_owner() or public.has_role('accounts'))
  with check (public.is_owner() or public.has_role('accounts'));
