-- Phase 46.01 — security hardening round (findings verified on the live DB).
--
-- Every function below is re-created from its LATEST definition in this
-- folder, with the same signature, SECURITY mode, search_path and grants;
-- only the lines each section describes are changed.

-- ===========================================================================
-- 1. anon could EXECUTE functions created after phase32_03.
-- ===========================================================================
-- phase32_03 changed the default privileges for PUBLIC only, but Supabase's
-- own default ACL grants EXECUTE on every new postgres-owned function in
-- public to `anon` explicitly. So every function created since then is
-- callable signed-out unless its migration revoked anon by hand. Two
-- SECURITY DEFINER ones never did:
--   fn_list_users_by_role(text)        (phase41_02) — leaks staff names/ids
--   fn_mark_notification_read(uuid)    (phase41_02)
-- The SECURITY INVOKER ones created since then (RLS still applies, but anon
-- has no business calling them either) are listed below too.

-- fn_list_users_by_role: plpgsql so it can refuse a caller with no session;
-- same RETURNS TABLE, same rows for a signed-in caller.
create or replace function public.fn_list_users_by_role(p_role_code text)
returns table (id uuid, full_name text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  return query
  select p.id, p.full_name
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id
  join public.roles r on r.id = ur.role_id
  where r.code = p_role_code and p.is_active
  order by p.full_name;
end;
$$;

revoke execute on function public.fn_list_users_by_role(text) from public, anon;
grant execute on function public.fn_list_users_by_role(text) to authenticated;

-- fn_mark_notification_read already scopes to recipient_user_id = auth.uid(),
-- so signed-out it is a no-op — but it is SECURITY DEFINER, so close it.
revoke execute on function public.fn_mark_notification_read(uuid) from public, anon;
grant execute on function public.fn_mark_notification_read(uuid) to authenticated;

-- SECURITY INVOKER functions created after phase32_03 that anon could also
-- execute (grants for authenticated were already explicit in their own
-- migrations, or come from phase32_03's default privileges).
revoke execute on function public.fn_order_health(integer) from public, anon;
revoke execute on function public.fn_jobs_by_health(text, text, integer, integer) from public, anon;
revoke execute on function public.fn_invoiceable_sales_orders_page(text, integer, integer) from public, anon;
revoke execute on function public.fn_deliverable_sales_orders_page(text, integer, integer) from public, anon;
revoke execute on function public.fn_party_outstanding(uuid, text, integer) from public, anon;
revoke execute on function public.describe_login_device(text) from public, anon;
revoke execute on function public.fn_activity_feed(integer, integer) from public, anon;
revoke execute on function public.fn_item_purchase_history(uuid, integer) from public, anon;
revoke execute on function public.fn_party_journal_balance(uuid, text) from public, anon;
-- Trigger function: needs no EXECUTE for the writing role at all.
revoke execute on function public.fn_guard_profile_is_active() from public, anon;

-- The actual root cause, two parts:
--  * phase32_03's `alter default privileges in schema public revoke execute
--    on functions from public` was a no-op: per-schema default privileges
--    are only ADDED to the global ones, and the built-in global default
--    gives PUBLIC EXECUTE on every new function. Verified locally: a
--    function created after phase32_03 still got `=X/postgres` (PUBLIC), so
--    anon could call it. The PUBLIC default has to be revoked globally.
--  * Supabase's own per-schema default ACL also grants anon EXECUTE
--    explicitly; revoke that too.
-- New public functions then get exactly authenticated + service_role (the
-- per-schema grant phase32_03 added). Functions postgres creates in the
-- `extensions` schema (CREATE EXTENSION) keep the PUBLIC grant they always
-- had, via a per-schema grant, so a future extension is not left unusable.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema extensions grant execute on functions to public;

-- ===========================================================================
-- 4 + 5. is_owner()/has_role(): deactivated users and MFA step-up.
-- ===========================================================================
-- A deactivated user's access token keeps working until it expires, and
-- getCurrentUser()'s is_active / aal checks only protect pages, not direct
-- REST/RPC calls. has_role() is the single gate behind every role check in
-- RLS and in every fn_* RPC (is_owner() is has_role('owner')), so it now
-- also requires:
--   * profiles.is_active for auth.uid();
--   * aal2 on the JWT when the user has a verified MFA factor — the same
--     rule as the app's getAuthenticatorAssuranceLevel() check
--     (nextLevel = aal2 <=> a verified factor exists). Users without MFA
--     are unaffected.
-- (select auth.uid()/auth.jwt()) so they are evaluated once (initplan).
create or replace function public.has_role(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = (select auth.uid()) and r.code = p_code
  )
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  )
  and (
    coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
    or not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = (select auth.uid()) and f.status = 'verified'
    )
  );
$$;

-- is_owner() is unchanged (still `select public.has_role('owner')`), so it
-- inherits both checks; re-stated here so the latest definition is in one
-- place.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('owner');
$$;

-- ===========================================================================
-- 2. Direct table writes bypassed the business rules in the fn_* RPCs.
-- ===========================================================================
-- Every business write on these tables goes through a SECURITY DEFINER fn_*
-- RPC (runs as the table owner, so RLS does not apply to it). The INSERT/
-- UPDATE/DELETE policies only let a role write rows over REST with none of
-- the RPC's checks (numbering, period lock, stock/AR consistency, journal
-- posting). Verified before dropping:
--   * src/ has no .from('<table>').insert/update/delete/upsert on any of
--     them (only master data: parties, items, warehouses, company, ...);
--   * Smart Merge (SECURITY INVOKER) only allows company/parties/warehouses/
--     vehicles/items (_fn_smart_merge_editable_columns);
--   * restore runs through SECURITY DEFINER fn_admin_restore_*; the offline
--     queue only calls fn_*_idempotent RPCs;
--   * no SECURITY INVOKER function or trigger function writes these tables.
-- SELECT policies are kept unchanged.
drop policy if exists p_insert on public.invoices;
drop policy if exists p_update on public.invoices;
drop policy if exists p_insert on public.invoice_lines;
drop policy if exists p_insert on public.supplier_bills;
drop policy if exists p_update on public.supplier_bills;
drop policy if exists p_insert on public.supplier_bill_lines;
drop policy if exists p_insert on public.payments;
drop policy if exists p_update on public.payments;
drop policy if exists p_insert on public.payment_allocations;
drop policy if exists p_insert on public.delivery_challans;
drop policy if exists p_update on public.delivery_challans;
drop policy if exists p_insert on public.delivery_challan_lines;
drop policy if exists p_insert on public.sales_orders;
drop policy if exists p_update on public.sales_orders;
drop policy if exists p_delete on public.sales_orders;
drop policy if exists p_insert on public.sales_order_lines;
drop policy if exists p_update on public.sales_order_lines;
drop policy if exists p_delete on public.sales_order_lines;
drop policy if exists p_insert on public.purchase_orders;
drop policy if exists p_update on public.purchase_orders;
drop policy if exists p_delete on public.purchase_orders;
drop policy if exists p_insert on public.purchase_order_lines;
drop policy if exists p_update on public.purchase_order_lines;
drop policy if exists p_delete on public.purchase_order_lines;
drop policy if exists p_insert on public.grns;
drop policy if exists p_insert on public.grn_lines;
drop policy if exists p_insert on public.sales_returns;
drop policy if exists p_update on public.sales_returns;
drop policy if exists p_insert on public.sales_return_lines;
drop policy if exists p_insert on public.purchase_returns;
drop policy if exists p_update on public.purchase_returns;
drop policy if exists p_insert on public.purchase_return_lines;
drop policy if exists p_insert on public.stock_transfers;
drop policy if exists p_update on public.stock_transfers;
drop policy if exists p_insert on public.stock_transfer_lines;
drop policy if exists p_insert on public.expenses;
drop policy if exists p_update on public.expenses;
drop policy if exists p_insert on public.contra_transfers;
drop policy if exists p_update on public.contra_transfers;
drop policy if exists p_insert on public.jobs;
drop policy if exists p_update on public.jobs;
drop policy if exists p_delete on public.jobs;
drop policy if exists p_insert on public.job_material_requirements;
drop policy if exists p_update on public.job_material_requirements;
drop policy if exists p_insert on public.stock_reservations;
drop policy if exists p_update on public.stock_reservations;

-- Safety net for policies the live DB may carry under other names (and for
-- journal_entries/journal_lines/stock_ledger, which have none in the repo):
-- drop any remaining INSERT/UPDATE/DELETE policy on these tables. A FOR ALL
-- policy would also grant SELECT, so it is not silently dropped — fail
-- loudly instead.
do $$
declare
  pol record;
  dropped int := 0;
begin
  for pol in
    select tablename, policyname, cmd
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'invoices', 'invoice_lines', 'supplier_bills', 'supplier_bill_lines',
        'payments', 'payment_allocations', 'delivery_challans', 'delivery_challan_lines',
        'sales_orders', 'sales_order_lines', 'purchase_orders', 'purchase_order_lines',
        'grns', 'grn_lines', 'sales_returns', 'sales_return_lines',
        'purchase_returns', 'purchase_return_lines', 'stock_transfers', 'stock_transfer_lines',
        'expenses', 'contra_transfers', 'jobs', 'job_material_requirements',
        'stock_reservations', 'journal_entries', 'journal_lines', 'stock_ledger')
      and cmd <> 'SELECT'
  loop
    if pol.cmd = 'ALL' then
      raise exception 'Policy % on % is FOR ALL — split it into SELECT + write before re-running', pol.policyname, pol.tablename;
    end if;
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
    raise notice 'dropped extra write policy % on %', pol.policyname, pol.tablename;
    dropped := dropped + 1;
  end loop;
  raise notice '% extra write policies dropped', dropped;
end $$;

-- ===========================================================================
-- 3. Storage: incoming/ email attachments were readable by every role.
-- ===========================================================================
-- fn_can_access_doc_type ended in `else true`, and incoming/<doc>/<file>
-- (written by the inbound-email webhook) is not a document type, so every
-- signed-in user could download inbound mail attachments. incoming/ now
-- follows incoming_documents' own audience (Owner/Sales).
--
-- Every prefix the app writes is now listed, so the default is false:
--   attachments.ts / AttachmentsPanel: queries, quotations, sales_orders,
--     purchase_orders, jobs, delivery_challans, expenses, vehicles;
--   queries.ts / salesOrders.ts copies: queries, sales_orders;
--   inbound-email webhook: incoming;  companyBranding.ts: company (handled in
--   the storage policy itself, never reaches this function).
-- The previously open types keep their previous audience (every role) by
-- an explicit branch. An unknown prefix is now denied rather than allowed.
create or replace function public.fn_can_access_doc_type(p_type text)
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when p_type in ('payments', 'expenses', 'contra_transfers', 'bank_accounts', 'petty_cash_funds', 'vehicles')
      then public.is_owner() or public.has_role('accounts') or public.has_role('auditor')
    when p_type in ('invoices', 'sales_returns')
      then public.is_owner() or public.has_role('accounts') or public.has_role('auditor') or public.has_role('sales')
    when p_type in ('supplier_bills', 'purchase_returns')
      then public.is_owner() or public.has_role('accounts') or public.has_role('auditor') or public.has_role('store')
    when p_type = 'incoming'
      then public.is_owner() or public.has_role('sales')
    when p_type in ('queries', 'quotations', 'sales_orders', 'purchase_orders', 'jobs', 'delivery_challans')
      then true
    else false
  end;
$$;

-- ===========================================================================
-- 6. Daily Snapshot cron failed every night, and was not "as of" p_date.
-- ===========================================================================
-- (a) pg_cron runs with auth.uid() null, so the role check inside
--     fn_generate_daily_snapshot rejected _fn_cron_generate_daily_snapshot
--     every night. The body moves to an internal core (no role check, not
--     callable over the API); the public RPC keeps the check and calls it;
--     the cron wrapper calls the core directly.
-- (b) The balances came from live views (cash_in_hand_balance,
--     bank_account_balances, ..., current_stock), so a backfill or a late
--     run recorded TODAY's position under p_date. They are now computed as
--     of the end of p_date:
--       cash/bank/petty/AR/AP — journal_lines whose entry_date <= p_date
--         (cash = account 1050, bank = lines tagged bank_account_id, petty =
--          lines tagged petty_cash_fund_id — the views' own rules; AR =
--          1200 Dr-Cr, AP = 2100 Cr-Dr, the fn_party_journal_balance rule);
--       stock — each item+warehouse's latest stock_ledger row created
--         before midnight after p_date, Asia/Karachi (current_stock's rule).
--     AR/AP are now ledger balances, so they include opening balances and
--     on-account advances; the old figures were open-invoice sums.
--     The day totals (sales/collections/payments/expenses) were already
--     date-scoped and are unchanged.
create or replace function public._fn_generate_daily_snapshot_core(p_date date)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cash numeric; v_bank numeric; v_petty numeric; v_stock numeric;
  v_ar numeric; v_ap numeric; v_sales numeric; v_collections numeric;
  v_payments numeric; v_expenses numeric; v_id uuid;
  v_day_end timestamptz := ((p_date + 1)::timestamp at time zone 'Asia/Karachi');
begin
  if p_date is null then
    raise exception 'A snapshot date is required.';
  end if;

  select
    coalesce(sum(jl.debit - jl.credit) filter (where coa.code = '1050'), 0),
    coalesce(sum(jl.debit - jl.credit) filter (where jl.bank_account_id is not null), 0),
    coalesce(sum(jl.debit - jl.credit) filter (where jl.petty_cash_fund_id is not null), 0),
    coalesce(sum(jl.debit - jl.credit) filter (where coa.code = '1200'), 0),
    coalesce(sum(jl.credit - jl.debit) filter (where coa.code = '2100'), 0)
  into v_cash, v_bank, v_petty, v_ar, v_ap
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  join public.chart_of_accounts coa on coa.id = jl.account_id
  where je.entry_date <= p_date;

  select coalesce(sum(round(s.running_balance * s.avg_cost, 2)), 0) into v_stock
  from (
    select distinct on (sl.item_id, sl.warehouse_id) sl.running_balance, sl.avg_cost
    from public.stock_ledger sl
    where sl.created_at < v_day_end
    order by sl.item_id, sl.warehouse_id, sl.created_at desc, sl.id desc
  ) s;

  select coalesce(sum(grand_total), 0) into v_sales
    from public.invoices where invoice_date = p_date and status = 'Posted';
  select coalesce(sum(amount), 0) into v_collections
    from public.payments where payment_date = p_date and status = 'Posted' and direction = 'receipt';
  select coalesce(sum(amount), 0) into v_payments
    from public.payments where payment_date = p_date and status = 'Posted' and direction = 'payment';
  select coalesce(sum(amount), 0) into v_expenses
    from public.expenses where expense_date = p_date and status = 'Posted';

  insert into public.daily_snapshots
    (snapshot_date, cash_in_hand, bank_balance, petty_cash_balance, stock_value,
     total_ar_outstanding, total_ap_outstanding, sales_today, collections_today,
     payments_today, expenses_today, generated_by)
  values
    (p_date, v_cash, v_bank, v_petty, v_stock, v_ar, v_ap, v_sales, v_collections,
     v_payments, v_expenses, auth.uid())
  on conflict (snapshot_date) do update set
    cash_in_hand = excluded.cash_in_hand,
    bank_balance = excluded.bank_balance,
    petty_cash_balance = excluded.petty_cash_balance,
    stock_value = excluded.stock_value,
    total_ar_outstanding = excluded.total_ar_outstanding,
    total_ap_outstanding = excluded.total_ap_outstanding,
    sales_today = excluded.sales_today,
    collections_today = excluded.collections_today,
    payments_today = excluded.payments_today,
    expenses_today = excluded.expenses_today,
    generated_at = now(),
    generated_by = excluded.generated_by
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public._fn_generate_daily_snapshot_core(date) from public, anon, authenticated;

-- Public RPC: same signature, same role check, same message.
create or replace function public.fn_generate_daily_snapshot(p_date date default current_date)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can generate the Daily Snapshot.';
  end if;
  return public._fn_generate_daily_snapshot_core(p_date);
end;
$function$;

-- Cron wrapper: straight to the core (no signed-in user under pg_cron).
create or replace function public._fn_cron_generate_daily_snapshot()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform public._fn_generate_daily_snapshot_core(current_date - 1);
end;
$function$;

-- ===========================================================================
-- 7. Offline JV skipped the period lock and dropped bank/petty tags.
-- ===========================================================================
-- fn_post_journal_entry_idempotent (phase29_08) inserted journal rows itself,
-- so an offline JV could be posted into a locked period, and any
-- bank_account_id / petty_cash_fund_id on its lines was silently dropped
-- (the line then never showed in that bank/petty balance). It now posts
-- through _fn_post_journal_entry_core like every other path.
--
-- The core generates the entry id itself, but the offline queue's
-- idempotency key IS the entry id (p_id), so the core gets an overload that
-- takes the id to use. The original 5-argument core becomes a wrapper that
-- passes null (= gen_random_uuid(), as before) — identical behaviour for
-- every existing caller.
create or replace function public._fn_post_journal_entry_core(p_entry_date date, p_narration text, p_source_table text, p_source_id uuid, p_lines jsonb, p_entry_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_entry_id uuid;
  v_entry_no text;
  v_line jsonb;
  v_account_id uuid;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_lock_date date;
begin
  select period_lock_date into v_lock_date from public.company limit 1;
  if v_lock_date is not null and p_entry_date <= v_lock_date then
    raise exception 'Yeh date (%) locked period mein hai (lock: %). Is date par koi nayi entry post nahi ho sakti.', p_entry_date, v_lock_date;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_total_debit := v_total_debit + coalesce((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + coalesce((v_line->>'credit')::numeric, 0);
  end loop;
  if round(v_total_debit - v_total_credit, 2) <> 0 then
    raise exception 'Journal entry balanced nahi hai (Debit: %, Credit: %).', v_total_debit, v_total_credit;
  end if;

  select public.fn_get_next_number('JV') into v_entry_no;

  insert into public.journal_entries (id, entry_no, entry_date, narration, source_table, source_id, created_by)
  values (coalesce(p_entry_id, gen_random_uuid()), v_entry_no, p_entry_date, p_narration, p_source_table, p_source_id, auth.uid())
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select id into v_account_id from public.chart_of_accounts where code = v_line->>'account_code';
    if v_account_id is null then
      raise exception 'Unknown chart of accounts code: %', v_line->>'account_code';
    end if;
    insert into public.journal_lines (journal_entry_id, account_id, party_id, bank_account_id, petty_cash_fund_id, debit, credit, memo)
    values (
      v_entry_id,
      v_account_id,
      nullif(v_line->>'party_id','')::uuid,
      nullif(v_line->>'bank_account_id','')::uuid,
      nullif(v_line->>'petty_cash_fund_id','')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      v_line->>'memo'
    );
  end loop;

  return v_entry_id;
end;
$function$;

revoke all on function public._fn_post_journal_entry_core(date, text, text, uuid, jsonb, uuid) from public, anon, authenticated;

create or replace function public._fn_post_journal_entry_core(p_entry_date date, p_narration text, p_source_table text, p_source_id uuid, p_lines jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return public._fn_post_journal_entry_core(p_entry_date, p_narration, p_source_table, p_source_id, p_lines, null::uuid);
end;
$function$;

-- Same signature, role check, validation messages and return value (p_id).
-- A per-key advisory lock replaces the old `on conflict (id) do nothing`
-- so two concurrent replays of the same offline write cannot both post:
-- the second waits, then finds the first one's entry.
create or replace function public.fn_post_journal_entry_idempotent(
  p_id uuid,
  p_entry_date date,
  p_narration text,
  p_lines jsonb -- [{account_code, party_id, bank_account_id, petty_cash_fund_id, debit, credit, memo}]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts may post journal entries.';
  end if;
  if p_id is null then
    raise exception 'An id is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('fn_post_journal_entry_idempotent:' || p_id::text, 0));

  select id into v_existing from public.journal_entries where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if coalesce(trim(p_narration), '') = '' then
    raise exception 'Narration is required.';
  end if;
  if jsonb_array_length(p_lines) < 2 then
    raise exception 'At least 2 lines are required (one Debit, one Credit).';
  end if;

  return public._fn_post_journal_entry_core(p_entry_date, p_narration, 'manual', null, p_lines, p_id);
end;
$$;

-- ===========================================================================
-- 8. fn_post_journal_entry trusted caller-supplied source_table/source_id.
-- ===========================================================================
-- Any Owner/Accounts user could post a JV tagged as e.g. ('invoices', <id>)
-- — hiding it from the Journal Vouchers register (which lists
-- source_table = 'manual') and making it look system-generated. Document
-- postings call _fn_post_journal_entry_core directly, never this RPC, so
-- every entry made here is a user-posted JV: always 'manual', no source id.
-- Parameters kept so the signature (and the app's calls) are unchanged;
-- the party/import opening-balance JVs (parties.ts, import.ts) now record as
-- 'manual' too and therefore also appear in the JV register.
create or replace function public.fn_post_journal_entry(
  p_entry_date date,
  p_narration text,
  p_source_table text,
  p_source_id uuid,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts may post journal entries.';
  end if;
  return public._fn_post_journal_entry_core(p_entry_date, p_narration, 'manual', null, p_lines);
end;
$$;

-- ===========================================================================
-- 9. Sales could UPDATE any column of incoming_documents.
-- ===========================================================================
-- p_update (phase43_01) lets Owner/Sales update whole rows over REST, so a
-- Sales user could rewrite the sender, subject, body, AI data or the
-- converted_* links. The app's own user-session updates touch only
-- status/reviewed_by/reviewed_at (markIncomingDocumentReviewedAction,
-- dismissIncomingDocumentAction) and sender_trust (trustSenderAction); the
-- Converted/converted_*_id updates go through the admin client. Column
-- grants limit authenticated to exactly those four columns (RLS still
-- decides which rows).
revoke update on public.incoming_documents from anon, authenticated;
grant update (status, reviewed_by, reviewed_at, sender_trust) on public.incoming_documents to authenticated;

-- ===========================================================================
-- Final sweep for item 1 + assertion.
-- ===========================================================================
-- Catch any other public function anon can still execute (e.g. one created
-- outside this repo's migrations). As in phase32_03: grant authenticated and
-- service_role first, so revoking PUBLIC cannot lock the app out.
do $$
declare
  f record; n int := 0; leftover int;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
    execute format('revoke execute on function %s from public', f.sig);
    execute format('revoke execute on function %s from anon', f.sig);
    raise notice 'revoked anon EXECUTE on %', f.sig;
    n := n + 1;
  end loop;

  select count(*) into leftover
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE');
  if leftover > 0 then
    raise exception 'anon can still execute % functions', leftover;
  end if;
  raise notice 'sweep revoked anon on % further functions', n;
end $$;
