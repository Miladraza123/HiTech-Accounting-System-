-- Phase 35.01 — Combined Activity Log
--
-- User request: one list showing, for every user, every day — sign-ins (with
-- IP), password changes, every business action (Query/Quotation/Payment/...
-- created, updated, deleted), and sign-outs — all interleaved in one
-- chronological feed rather than split across separate pages, in Pakistan
-- Standard Time.
--
-- What already existed and needed no new plumbing:
--   * login_sessions — login_at, logout_at, ip_address, device_info per
--     session (this is what the old "Login History" page showed).
--   * audit_log — a generic field-level change log already firing on 30
--     tables via the existing trg_audit / fn_audit_row() trigger (queries,
--     quotations, sales_orders, invoices, payments, jobs, tasks, parties,
--     items, ... — every table that matters for this feed except three).
-- Neither was ever combined into one view before this migration.
--
-- What was genuinely missing, and is added here:
--   1. Password changes have no trail at all today (neither self-service
--      change nor an Owner's reset of someone else's password touches any
--      table fn_audit_row watches — it's a Supabase Auth API call, not a
--      `public` schema row). fn_log_password_change() is a new, narrow,
--      explicit log call the app fires after a successful change; wired
--      into changePasswordAction and resetUserPasswordAction in the same
--      commit as this migration.
--   2. Activating/deactivating a user (profiles.is_active) has never been
--      audited — `profiles` never got the generic trigger. It gets it now.
--   3. Journal Vouchers (journal_entries) and GRNs (grns) are two business
--      documents that also never got the generic trigger, for no evident
--      reason (every sibling document — invoices, purchase orders, supplier
--      bills, delivery challans — already has it). Added here for the same
--      reason those already have it.
--
-- Everything below is strictly additive: new triggers (same trigger
-- function every other audited table already uses — zero new risk), two new
-- functions, one new index. Nothing existing is altered.

-- ---------------------------------------------------------------------------
-- 1. Close the three audit-trigger gaps
-- ---------------------------------------------------------------------------

-- profiles: the feed only ever cares about the is_active flag (deactivate /
-- reactivate). The trigger itself logs every field, same as it does on every
-- other table — the feed-building function below is what filters it down to
-- is_active — so a future feature (e.g. auditing name changes) is not
-- foreclosed on.
create trigger trg_audit after insert or update or delete on public.profiles
  for each row execute function public.fn_audit_row();

create trigger trg_audit after insert or update or delete on public.journal_entries
  for each row execute function public.fn_audit_row();

create trigger trg_audit after insert or update or delete on public.grns
  for each row execute function public.fn_audit_row();

-- The feed sorts newest-first across every audited table at once; without
-- this, that sort has no index to use and falls back to scanning and sorting
-- the whole table on every page view.
create index if not exists idx_audit_log_at on public.audit_log(at desc);

-- ---------------------------------------------------------------------------
-- 2. Password-change events
-- ---------------------------------------------------------------------------
-- Reuses audit_log rather than a new table — same shape (actor_id, at), and
-- audit_log's own RLS (`is_owner() OR has_role('auditor')`) already gives
-- this the right read restriction for free. table_name has no FK/CHECK
-- constraint (it's already polymorphic by design), so 'auth_password' as a
-- synthetic value is safe. No password data of any kind is stored — this is
-- a pure event marker: who changed whose password, and when.
--
-- `field` distinguishes a self-service change from an Owner's reset of
-- someone else's password purely by NAME (not by inspecting actor vs
-- row_id), because deriving it from actor_id = row_id would break the
-- instant a future admin-impersonation path is added; being explicit here
-- costs nothing and stays correct regardless.
create or replace function public.fn_log_password_change(p_subject_user_id uuid, p_self_change boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (table_name, row_id, action, field, actor_id)
  values ('auth_password', p_subject_user_id, 'UPDATE', case when p_self_change then 'self_change' else 'admin_reset' end, auth.uid());
end;
$$;

grant execute on function public.fn_log_password_change(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Device description helper (used by the feed function below — defined
--    first because a `language sql` function's body is validated against the
--    catalog at CREATE time, so it must already exist).
-- ---------------------------------------------------------------------------
-- login_sessions.device_info is a raw User-Agent string; the app already has
-- a TypeScript helper (describeUserAgent, src/lib/userAgent.ts) that turns it
-- into "Chrome on Windows" etc for the Login History table. A small SQL twin
-- so fn_activity_feed's `detail` column reads the same way without shipping
-- the raw UA string. Deliberately partial (this app's actual traffic) rather
-- than a general UA parser.
create or replace function public.describe_login_device(p_user_agent text)
returns text
language sql
immutable
as $$
  select case
    when p_user_agent is null or trim(p_user_agent) = '' then null
    when p_user_agent ~* 'edg/' then 'Edge'
    when p_user_agent ~* 'chrome/' and p_user_agent !~* 'edg/' then 'Chrome'
    when p_user_agent ~* 'firefox/' then 'Firefox'
    when p_user_agent ~* 'safari/' and p_user_agent !~* 'chrome/' then 'Safari'
    else 'Browser'
  end
  || ' on '
  || case
    when p_user_agent ~* 'android' then 'Android'
    when p_user_agent ~* 'iphone|ipad' then 'iOS'
    when p_user_agent ~* 'windows' then 'Windows'
    when p_user_agent ~* 'mac os' then 'Mac'
    when p_user_agent ~* 'linux' then 'Linux'
    else 'Unknown device'
  end;
$$;

grant execute on function public.describe_login_device(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The combined feed
-- ---------------------------------------------------------------------------
-- security invoker (the default — no explicit clause, matching every other
-- report function in this app, e.g. fn_owner_dashboard/fn_pending_orders):
-- access control is RLS on the underlying tables, not a check inside this
-- function. audit_log and login_sessions are both already restricted to
-- Owner + Auditor (login_sessions also lets a user see their own rows,
-- harmless here since the page itself gates on Owner/Auditor before ever
-- calling this). The Owner already reads every business table this joins
-- against; the Auditor role is already used for the same purpose by the
-- existing reports.
--
-- Returns UTC timestamps deliberately — Pakistan Standard Time formatting
-- and day-grouping happen in the page, the same way reports/page.tsx already
-- computes Asia/Karachi time via Intl rather than in SQL.
create or replace function public.fn_activity_feed(p_limit integer, p_offset integer)
returns table (
  at timestamptz,
  actor_name text,
  event_type text,
  summary text,
  doc_no text,
  detail text,
  ip_address text,
  link_href text,
  total_rows bigint
)
language sql
stable
set search_path to 'public'
as $function$
  with
  -- Sign-ins. One row per session.
  logins as (
    select ls.login_at as at,
           coalesce(p.full_name, 'Unknown user') as actor_name,
           'login' as event_type,
           'Signed in' as summary,
           null::text as doc_no,
           nullif(trim(both from public.describe_login_device(ls.device_info)), '') as detail,
           ls.ip_address::text as ip_address,
           null::text as link_href
    from public.login_sessions ls
    left join public.profiles p on p.id = ls.user_id
  ),
  -- Sign-outs. Only sessions that actually ended.
  logouts as (
    select ls.logout_at as at,
           coalesce(p.full_name, 'Unknown user') as actor_name,
           'logout' as event_type,
           'Signed out' as summary,
           null::text as doc_no,
           null::text as detail,
           null::text as ip_address,
           null::text as link_href
    from public.login_sessions ls
    left join public.profiles p on p.id = ls.user_id
    where ls.logout_at is not null
  ),
  -- Password changes.
  password_events as (
    select al.at,
           coalesce(actor_p.full_name, 'Unknown user') as actor_name,
           'password' as event_type,
           case when al.field = 'self_change' then 'Changed own password'
                else 'Reset password for ' || coalesce(subj_p.full_name, 'a user') end as summary,
           null::text as doc_no,
           null::text as detail,
           null::text as ip_address,
           null::text as link_href
    from public.audit_log al
    left join public.profiles actor_p on actor_p.id = al.actor_id
    left join public.profiles subj_p on subj_p.id = al.row_id
    where al.table_name = 'auth_password'
  ),
  -- User activated / deactivated. Only the is_active field is surfaced —
  -- the trigger logs every profile field, this narrows it down.
  user_status_events as (
    select al.at,
           coalesce(actor_p.full_name, 'Unknown user') as actor_name,
           'update' as event_type,
           case when al.new_value = 'true' then 'Activated user ' else 'Deactivated user ' end
             || coalesce(subj_p.full_name, 'a user') as summary,
           null::text as doc_no,
           null::text as detail,
           null::text as ip_address,
           null::text as link_href
    from public.audit_log al
    left join public.profiles actor_p on actor_p.id = al.actor_id
    left join public.profiles subj_p on subj_p.id = al.row_id
    where al.table_name = 'profiles' and al.action = 'UPDATE' and al.field = 'is_active'
  ),
  -- Every business document: header tables only (line-item child tables —
  -- sales_order_lines, purchase_order_lines — are deliberately excluded so
  -- the feed stays one line per real action; the header row's own audit
  -- entry already captures "this document changed" whenever its lines do,
  -- since every function that edits lines also updates the header).
  --
  -- A plain UPDATE touching N fields produces N audit_log rows sharing the
  -- same (table_name, row_id, actor_id, action, at) — grouped back into one
  -- event here, with the changed fields folded into one compact line.
  grouped as (
    select table_name, row_id, actor_id, action, at,
           nullif(
             case when length(d) > 220 then left(d, 217) || '...' else d end,
             ''
           ) as detail
    from (
      select table_name, row_id, actor_id, action, at,
             string_agg(
               field || ': ' || coalesce(nullif(left(old_value, 30), ''), '—')
                 || ' → ' || coalesce(nullif(left(new_value, 30), ''), '—'),
               ', ' order by field
             ) filter (where field is not null) as d
      from public.audit_log
      where table_name in (
        'queries','quotations','quotation_revisions','sales_orders','delivery_challans','invoices',
        'purchase_orders','supplier_bills','jobs','tasks','vehicles','parties','items','payments',
        'expenses','sales_returns','purchase_returns','stock_transfers','stock_adjustments',
        'product_templates','journal_entries','grns','contra_transfers','bank_accounts',
        'petty_cash_funds','expense_heads','chart_of_accounts','warehouses','company'
      )
      -- quotation_revisions is INSERT-only for this feed's purposes (a new
      -- revision) — its own is_current UPDATE flips are internal bookkeeping,
      -- not something a person did.
      and not (table_name = 'quotation_revisions' and action = 'UPDATE')
      group by table_name, row_id, actor_id, action, at
    ) x
  ),
  business_events as (
    select g.at,
           coalesce(p.full_name, 'Unknown user') as actor_name,
           lower(g.action) as event_type,
           (case g.action when 'INSERT' then 'Created ' when 'DELETE' then 'Deleted ' else 'Updated ' end)
             || label.doc_type as summary,
           label.doc_no,
           g.detail,
           null::text as ip_address,
           label.link_href
    from grouped g
    left join public.profiles p on p.id = g.actor_id
    left join lateral (
      select
        case g.table_name
          when 'queries' then 'Query'
          when 'quotations' then 'Quotation'
          when 'quotation_revisions' then 'Quotation Revision'
          when 'sales_orders' then 'Sales Order'
          when 'delivery_challans' then 'Delivery Challan'
          when 'invoices' then 'Invoice'
          when 'purchase_orders' then 'Purchase Order'
          when 'supplier_bills' then 'Supplier Bill'
          when 'jobs' then 'Job'
          when 'tasks' then 'Task'
          when 'vehicles' then 'Vehicle'
          when 'parties' then coalesce(
            (select case party_type when 'client' then 'Client' when 'supplier' then 'Supplier' else 'Client/Supplier' end
               from public.parties where id = g.row_id),
            'Client/Supplier'
          )
          when 'items' then 'Item'
          when 'payments' then 'Payment'
          when 'expenses' then 'Expense'
          when 'sales_returns' then 'Sales Return'
          when 'purchase_returns' then 'Purchase Return'
          when 'stock_transfers' then 'Stock Transfer'
          when 'stock_adjustments' then 'Stock Adjustment'
          when 'product_templates' then 'BOM Template'
          when 'journal_entries' then 'Journal Voucher'
          when 'grns' then 'GRN'
          when 'contra_transfers' then 'Fund Transfer'
          when 'bank_accounts' then 'Bank Account'
          when 'petty_cash_funds' then 'Petty Cash Fund'
          when 'expense_heads' then 'Expense Head'
          when 'chart_of_accounts' then 'Chart of Accounts'
          when 'warehouses' then 'Warehouse'
          when 'company' then 'Company Profile'
          else initcap(replace(g.table_name, '_', ' '))
        end as doc_type,
        case g.table_name
          when 'queries' then (select query_no from public.queries where id = g.row_id)
          when 'quotations' then (select quotation_no from public.quotations where id = g.row_id)
          when 'quotation_revisions' then (
            select 'Rev ' || qr.rev_no || ' of ' || q.quotation_no
            from public.quotation_revisions qr join public.quotations q on q.id = qr.quotation_id
            where qr.id = g.row_id
          )
          when 'sales_orders' then (select so_no from public.sales_orders where id = g.row_id)
          when 'delivery_challans' then (select dc_no from public.delivery_challans where id = g.row_id)
          when 'invoices' then (select invoice_no from public.invoices where id = g.row_id)
          when 'purchase_orders' then (select po_no from public.purchase_orders where id = g.row_id)
          when 'supplier_bills' then (select bill_no from public.supplier_bills where id = g.row_id)
          when 'jobs' then (select job_no from public.jobs where id = g.row_id)
          when 'tasks' then (select title from public.tasks where id = g.row_id)
          when 'vehicles' then (select vehicle_no from public.vehicles where id = g.row_id)
          when 'parties' then (select legal_name from public.parties where id = g.row_id)
          when 'items' then (select item_code from public.items where id = g.row_id)
          when 'payments' then (select payment_no from public.payments where id = g.row_id)
          when 'expenses' then (select expense_no from public.expenses where id = g.row_id)
          when 'sales_returns' then (select return_no from public.sales_returns where id = g.row_id)
          when 'purchase_returns' then (select return_no from public.purchase_returns where id = g.row_id)
          when 'stock_transfers' then (select transfer_no from public.stock_transfers where id = g.row_id)
          when 'stock_adjustments' then (select i.item_code from public.stock_adjustments sa join public.items i on i.id = sa.item_id where sa.id = g.row_id)
          when 'product_templates' then (select name from public.product_templates where id = g.row_id)
          when 'journal_entries' then (select entry_no from public.journal_entries where id = g.row_id)
          when 'grns' then (select grn_no from public.grns where id = g.row_id)
          when 'contra_transfers' then (select transfer_no from public.contra_transfers where id = g.row_id)
          when 'bank_accounts' then (select account_name from public.bank_accounts where id = g.row_id)
          when 'petty_cash_funds' then (select fund_name from public.petty_cash_funds where id = g.row_id)
          when 'expense_heads' then (select name from public.expense_heads where id = g.row_id)
          when 'chart_of_accounts' then (select code || ' — ' || name from public.chart_of_accounts where id = g.row_id)
          when 'warehouses' then (select name from public.warehouses where id = g.row_id)
          when 'company' then (select legal_name from public.company where id = g.row_id)
          else null
        end as doc_no,
        case g.table_name
          when 'queries' then '/queries/' || g.row_id
          when 'quotations' then '/quotations/' || g.row_id
          when 'quotation_revisions' then (select '/quotations/' || quotation_id from public.quotation_revisions where id = g.row_id)
          when 'sales_orders' then '/sales-orders/' || g.row_id
          when 'delivery_challans' then '/delivery-challans/' || g.row_id
          when 'invoices' then '/invoices/' || g.row_id
          when 'purchase_orders' then '/purchase-orders/' || g.row_id
          when 'supplier_bills' then '/supplier-bills/' || g.row_id
          when 'jobs' then '/jobs/' || g.row_id
          when 'tasks' then '/tasks/' || g.row_id
          when 'vehicles' then '/setup/vehicles/' || g.row_id
          when 'parties' then '/clients/' || g.row_id
          when 'items' then '/items/' || g.row_id
          when 'payments' then '/payments/' || g.row_id
          when 'expenses' then '/expenses/' || g.row_id
          when 'sales_returns' then '/sales-returns/' || g.row_id
          when 'purchase_returns' then '/purchase-returns/' || g.row_id
          when 'stock_transfers' then '/transfers/' || g.row_id
          when 'product_templates' then '/product-templates/' || g.row_id
          else null
        end as link_href
    ) label on true
  ),
  events as (
    select * from logins
    union all select * from logouts
    union all select * from password_events
    union all select * from user_status_events
    union all select * from business_events
  ),
  counted as (
    select *, count(*) over () as total_rows
    from events
    where at is not null
  )
  select at, actor_name, event_type, summary, doc_no, detail, ip_address, link_href, total_rows
  from counted
  order by at desc, actor_name, event_type
  offset p_offset
  limit p_limit;
$function$;

grant execute on function public.fn_activity_feed(integer, integer) to authenticated;
