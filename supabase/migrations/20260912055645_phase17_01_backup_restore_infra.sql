-- ============================================================
-- Phase 17 — Daily Backup & Restore infrastructure.
--
-- 1. A new, genuinely low-privilege 'backup' role: read-only, and only
--    over the two tables that the universal `p_select using(true)`
--    policy doesn't already cover for every table (import_batches,
--    user_roles) — combined with the existing 'auditor' role (which
--    already covers audit_log/journal_entries/journal_lines/
--    login_sessions), the Backup Bot account gets exactly the read
--    access a full backup needs and nothing else: no write capability
--    anywhere, matching "never use a service-role/admin key".
-- 2. Two SECURITY DEFINER functions backing the in-app Restore feature
--    — Owner-only, and restricted to a hardcoded table allowlist (never
--    an arbitrary caller-supplied table name), using Postgres's own
--    type-checked jsonb_populate_recordset() rather than any string-
--    built value interpolation, so a malformed/malicious JSON payload
--    fails type conversion rather than executing as SQL.
--
-- RECOVERED FROM THE LIVE DATABASE. This migration had been applied to
-- the project but its file was missing from supabase/migrations, so a
-- rebuild from the repo would have produced a database with no Backup &
-- Restore at all. Restored verbatim from
-- supabase_migrations.schema_migrations. The Roman-Urdu exception
-- messages below are the original text; later migrations translate
-- them, and the live functions are already in English.
-- ============================================================

insert into public.roles (code, name, description)
values ('backup', 'Backup Bot', 'Low-privilege, read-only account used only by the automated Daily Backup job.')
on conflict (code) do nothing;

drop policy if exists p_select on public.import_batches;
create policy p_select on public.import_batches for select
  using (public.is_owner() or public.has_role('accounts') or public.has_role('backup'));

drop policy if exists p_select on public.user_roles;
create policy p_select on public.user_roles for select
  using (user_id = (select auth.uid()) or public.is_owner() or public.has_role('backup'));

-- ---------- Shared: table allowlist + primary-key columns ----------
-- Returns null for any table not on the allowlist — every caller below
-- treats null as "reject", so this doubles as the security boundary.
create or replace function public._fn_restore_pk_columns(p_table_name text)
returns text[]
language sql
immutable
as $function$
  select case p_table_name
    when 'provinces' then array['code']
    when 'query_sources' then array['code']
    when 'units' then array['code']
    when 'role_permissions' then array['permission_key']
    when 'unit_conversions' then array['from_unit','to_unit']
    when 'user_roles' then array['user_id','role_id']
    when 'roles' then array['id']
    when 'company' then array['id']
    when 'warehouses' then array['id']
    when 'chart_of_accounts' then array['id']
    when 'expense_heads' then array['id']
    when 'bank_accounts' then array['id']
    when 'petty_cash_funds' then array['id']
    when 'vehicles' then array['id']
    when 'items' then array['id']
    when 'item_alt_units' then array['id']
    when 'product_templates' then array['id']
    when 'product_template_lines' then array['id']
    when 'parties' then array['id']
    when 'party_contacts' then array['id']
    when 'queries' then array['id']
    when 'quotations' then array['id']
    when 'quotation_revisions' then array['id']
    when 'quotation_lines' then array['id']
    when 'sales_orders' then array['id']
    when 'sales_order_lines' then array['id']
    when 'sales_order_revisions' then array['id']
    when 'purchase_orders' then array['id']
    when 'purchase_order_lines' then array['id']
    when 'grns' then array['id']
    when 'grn_lines' then array['id']
    when 'jobs' then array['id']
    when 'job_material_requirements' then array['id']
    when 'job_cost_ledger' then array['id']
    when 'stock_reservations' then array['id']
    when 'stock_ledger' then array['id']
    when 'stock_adjustments' then array['id']
    when 'stock_transfers' then array['id']
    when 'stock_transfer_lines' then array['id']
    when 'delivery_challans' then array['id']
    when 'delivery_challan_lines' then array['id']
    when 'invoices' then array['id']
    when 'invoice_lines' then array['id']
    when 'supplier_bills' then array['id']
    when 'supplier_bill_lines' then array['id']
    when 'sales_returns' then array['id']
    when 'sales_return_lines' then array['id']
    when 'purchase_returns' then array['id']
    when 'purchase_return_lines' then array['id']
    when 'payments' then array['id']
    when 'payment_allocations' then array['id']
    when 'contra_transfers' then array['id']
    when 'expenses' then array['id']
    when 'journal_entries' then array['id']
    when 'journal_lines' then array['id']
    when 'numbering_sequences' then array['id']
    when 'daily_snapshots' then array['id']
    when 'tasks' then array['id']
    when 'activity_timeline' then array['id']
    when 'attachments' then array['id']
    when 'audit_log' then array['id']
    when 'import_batches' then array['id']
    when 'login_sessions' then array['id']
    when 'profiles' then array['id']
    else null
  end;
$function$;

-- ---------- Plan (dry-run, no writes) ----------
create or replace function public.fn_admin_restore_plan(p_table_name text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pk_cols text[] := public._fn_restore_pk_columns(p_table_name);
  v_match_expr text;
  v_incoming int;
  v_existing_matched int;
  v_existing_total int;
begin
  if not public.is_owner() then
    raise exception 'Sirf Owner restore plan dekh sakte hain.';
  end if;
  if v_pk_cols is null then
    raise exception 'Table % restore ke liye allowed nahi hai.', p_table_name;
  end if;

  select string_agg(format('t.%1$I = r.%1$I', c), ' and ') into v_match_expr from unnest(v_pk_cols) c;

  execute format('select count(*) from jsonb_populate_recordset(null::public.%I, $1)', p_table_name)
    using p_rows into v_incoming;

  execute format(
    'select count(*) from public.%1$I t where exists (select 1 from jsonb_populate_recordset(null::public.%1$I, $1) r where %2$s)',
    p_table_name, v_match_expr
  ) using p_rows into v_existing_matched;

  execute format('select count(*) from public.%I', p_table_name) into v_existing_total;

  return jsonb_build_object(
    'table', p_table_name,
    'incoming', v_incoming,
    'to_add', v_incoming - v_existing_matched,
    'to_update', v_existing_matched,
    'existing_total', v_existing_total,
    'to_delete_if_replace', v_existing_total - v_existing_matched
  );
end;
$function$;

-- ---------- Commit (actually writes) ----------
create or replace function public.fn_admin_restore_table(p_table_name text, p_mode text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pk_cols text[] := public._fn_restore_pk_columns(p_table_name);
  v_conflict_target text;
  v_match_expr text;
  v_update_set text;
  v_before_count int;
  v_after_count int;
  v_incoming int;
begin
  if not public.is_owner() then
    raise exception 'Sirf Owner restore kar sakte hain.';
  end if;
  if v_pk_cols is null then
    raise exception 'Table % restore ke liye allowed nahi hai.', p_table_name;
  end if;
  if p_mode not in ('merge', 'replace') then
    raise exception 'Mode "merge" ya "replace" hona chahiye.';
  end if;

  select string_agg(format('%I', c), ', ') into v_conflict_target from unnest(v_pk_cols) c;
  select string_agg(format('t.%1$I = r.%1$I', c), ' and ') into v_match_expr from unnest(v_pk_cols) c;

  execute format('select count(*) from jsonb_populate_recordset(null::public.%I, $1)', p_table_name)
    using p_rows into v_incoming;
  execute format('select count(*) from public.%I', p_table_name) into v_before_count;

  if p_mode = 'replace' then
    execute format(
      'delete from public.%1$I t where not exists (select 1 from jsonb_populate_recordset(null::public.%1$I, $1) r where %2$s)',
      p_table_name, v_match_expr
    ) using p_rows;

    select string_agg(format('%1$I = excluded.%1$I', column_name), ', ') into v_update_set
    from information_schema.columns
    where table_schema = 'public' and table_name = p_table_name and not (column_name = any(v_pk_cols));

    if v_update_set is null then
      -- table is 100% primary key columns (no other columns to update) — nothing to do on conflict
      execute format(
        'insert into public.%1$I select * from jsonb_populate_recordset(null::public.%1$I, $1) on conflict (%2$s) do nothing',
        p_table_name, v_conflict_target
      ) using p_rows;
    else
      execute format(
        'insert into public.%1$I select * from jsonb_populate_recordset(null::public.%1$I, $1) on conflict (%2$s) do update set %3$s',
        p_table_name, v_conflict_target, v_update_set
      ) using p_rows;
    end if;
  else
    execute format(
      'insert into public.%1$I select * from jsonb_populate_recordset(null::public.%1$I, $1) on conflict (%2$s) do nothing',
      p_table_name, v_conflict_target
    ) using p_rows;
  end if;

  execute format('select count(*) from public.%I', p_table_name) into v_after_count;

  return jsonb_build_object(
    'table', p_table_name,
    'mode', p_mode,
    'incoming', v_incoming,
    'before_count', v_before_count,
    'after_count', v_after_count
  );
end;
$function$;

revoke all on function public.fn_admin_restore_plan(text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_admin_restore_plan(text, jsonb) to authenticated;
revoke all on function public.fn_admin_restore_table(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_admin_restore_table(text, text, jsonb) to authenticated;
