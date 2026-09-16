-- Phase 34 — two hardening items the Supabase security advisor still reports
--
-- Both are defence in depth: neither is reachable through the app's API today.
-- They are closed because closing them costs nothing and removes a whole class
-- of question, rather than because an exploit was found.

-- ---------------------------------------------------------------------------
-- 1. Pin search_path on the four Owner Dashboard functions
-- ---------------------------------------------------------------------------
-- Phase 32.04 pinned `search_path` on the report functions and missed these
-- four, which arrived later in Phase 31.09. Phase 33 rewrote their bodies for
-- speed and deliberately left the signature alone so that only performance
-- changed; this is the follow-up that was owed.
--
-- Without the clause, the function runs with whatever `search_path` the caller
-- has, so an unqualified name could resolve to an object in another schema.
-- These four already schema-qualify every table and function they touch, so
-- the clause changes no behaviour at all — it just removes the dependency on
-- the caller. The bodies below are byte-identical to what Phase 33 deployed.

create or replace function public.fn_dashboard_trend(p_line text, p_from date, p_to date)
returns table (day date, queries bigint, quotations bigint, sales_orders bigint)
language sql
security invoker
stable
set search_path to 'public'
as $$
  with days as (select generate_series(p_from, p_to, interval '1 day')::date as d),
  q as materialized (
    select (q.created_at at time zone 'UTC')::date as d, count(*) as n
    from public.queries q
    where (q.created_at at time zone 'UTC')::date between p_from and p_to
    group by 1
  ),
  qt as materialized (
    select (q.created_at at time zone 'UTC')::date as d, count(*) as n
    from public.quotations q
    where q.status <> 'Draft'
      and (q.created_at at time zone 'UTC')::date between p_from and p_to
    group by 1
  ),
  so as materialized (
    select (s.created_at at time zone 'UTC')::date as d, count(*) as n
    from public.sales_orders s
    where (p_line = 'combined' or s.business_line = p_line)
      and (s.created_at at time zone 'UTC')::date between p_from and p_to
    group by 1
  )
  select d.d, coalesce(q.n, 0), coalesce(qt.n, 0), coalesce(so.n, 0)
  from days d
  left join q  on q.d  = d.d
  left join qt on qt.d = d.d
  left join so on so.d = d.d
  order by d.d;
$$;

create or replace function public.fn_dashboard_job_status(p_line text)
returns table (id uuid, job_no text, progress_pct numeric, so_no text, client text, health_label text)
language sql
security invoker
stable
set search_path to 'public'
as $$
  select id, job_no, progress_pct, so_no, client, health_label
  from (
    select j.id,
           j.job_no,
           j.progress_pct,
           so.so_no,
           coalesce(p.legal_name, '—') as client,
           case
             when j.required_delivery_date is not null
                  and floor(extract(epoch from ((j.required_delivery_date::timestamp at time zone 'UTC') - now())) / 86400) < 0
               then 'Delayed'
             when j.required_delivery_date is not null
                  and floor(extract(epoch from ((j.required_delivery_date::timestamp at time zone 'UTC') - now())) / 86400) <= 3
               then 'AtRisk'
             when floor(extract(epoch from (now() - j.updated_at)) / 86400) > 10
               then 'Stalled'
             else 'OnTrack'
           end as health_label,
           j.updated_at
    from public.jobs j
    left join public.sales_orders so on so.id = j.sales_order_id
    left join public.parties p on p.id = so.party_id
    where p_line <> 'material_supply'
      and j.status not in ('Delivered','Cancelled')
  ) x
  order by case health_label when 'Delayed' then 0 when 'Stalled' then 1 when 'AtRisk' then 2 else 3 end,
           updated_at desc,
           id
  limit 6;
$$;

create or replace function public.fn_dashboard_pending_delivery(p_line text)
returns table (so_no text, client text, days integer)
language sql
security invoker
stable
set search_path to 'public'
as $$
  select so.so_no, coalesce(p.legal_name, '—'), public.fn_days_since(so.po_date)
  from public.sales_order_lines l
  join public.sales_orders so on so.id = l.sales_order_id
  left join public.parties p on p.id = so.party_id
  where so.status not in ('Cancelled','Closed')
    and (p_line = 'combined' or so.business_line = p_line)
    and l.ordered_qty - l.delivered_qty > 0.001
  order by so.po_date asc, so.id, l.id
  limit 6;
$$;

create or replace function public.fn_dashboard_payment_followups()
returns table (invoice_id uuid, party_id uuid, client text, amount numeric, overdue_days integer)
language sql
security invoker
stable
set search_path to 'public'
as $$
  select o.invoice_id, p.id, p.legal_name, o.outstanding_amount,
         public.fn_days_since((i.invoice_date + coalesce(p.credit_days, 0))::date)
  from public.invoice_outstanding o
  join public.invoices i on i.id = o.invoice_id
  join public.parties p on p.id = i.party_id
  where o.outstanding_amount > 0
    and floor(extract(epoch from (now() - (((i.invoice_date + coalesce(p.credit_days, 0))::date)::timestamp at time zone 'UTC'))) / 86400) > 0
  order by (i.invoice_date + coalesce(p.credit_days, 0)) asc, o.invoice_id
  limit 6;
$$;

-- ---------------------------------------------------------------------------
-- 2. Take TRUNCATE away from anon and authenticated
-- ---------------------------------------------------------------------------
-- Supabase ships every project with `GRANT ALL ON ALL TABLES IN SCHEMA public
-- TO anon, authenticated`, and ALL includes TRUNCATE. That matters more than
-- the other privileges in the set for one specific reason:
--
--   Row Level Security does not apply to TRUNCATE.
--
-- Every SELECT/INSERT/UPDATE/DELETE this app exposes is filtered by an RLS
-- policy, so a caller holding the anon key still sees and changes only what the
-- policies allow. TRUNCATE skips that check entirely and empties the table.
--
-- It is not reachable through the app as it stands: PostgREST only ever issues
-- SELECT/INSERT/UPDATE/DELETE and RPC calls, never TRUNCATE, and nothing in
-- this repository issues one either (checked across every migration and every
-- line of application code). So this closes a path rather than fixing a leak —
-- but it is the one privilege in that default grant where RLS is not a
-- backstop, and PostgREST has no use for it.
--
-- The other privileges stay: a/r/w/d are what PostgREST actually needs, and
-- REFERENCES / TRIGGER / MAINTAIN all require DDL, which the API cannot issue.
revoke truncate on all tables in schema public from anon, authenticated;

-- Without this, the very next migration that creates a table would hand
-- TRUNCATE straight back: the default privileges are what granted it in the
-- first place. Only the `postgres` defaults are touched, because migrations run
-- as `postgres` and so that is the set new tables inherit.
alter default privileges for role postgres in schema public
  revoke truncate on tables from anon, authenticated;

-- Fail loudly rather than reporting success if either half did not take.
do $$
declare leftover int;
begin
  select count(*) into leftover
  from information_schema.role_table_grants
  where table_schema = 'public'
    and privilege_type = 'TRUNCATE'
    and grantee in ('anon', 'authenticated');
  if leftover > 0 then
    raise exception 'TRUNCATE is still granted on % table(s) to anon/authenticated', leftover;
  end if;
end $$;
