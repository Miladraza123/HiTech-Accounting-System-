-- Phase 33.01 — Make the report/dashboard functions survive real data volume
--
-- Measured on a Supabase branch loaded with 5,000 parties, 120,000 invoices /
-- sales orders / jobs / queries / quotations and 240,000 lines on each of the
-- three line tables (1,327,000 rows total). Two of these functions did not
-- merely get slow -- they exceeded the 8-second statement_timeout that Supabase
-- sets on the `authenticated` role, i.e. the page they feed returns an error:
--
--   fn_dashboard_trend(365 days)  32,160 ms   -> Owner Dashboard fails outright
--   fn_ar_aging                   12,014 ms   -> AR Aging report fails outright
--                                                (reproduced: SQLSTATE 57014)
--   fn_owner_dashboard             5,373 ms   -> passes, but with no headroom
--   fn_dashboard_payment_followups 2,065 ms
--   fn_dashboard_job_status        1,888 ms
--   fn_pending_orders              1,301 ms
--
-- Three causes, all of them shape rather than missing indexes:
--
--  1. A plain (non-MATERIALIZED) CTE referenced N times is *executed* N times.
--     fn_owner_dashboard reads job_health 5x and so_health/po_health 4x each;
--     fn_ar_aging evaluates its `bucket` expression once per FILTER clause,
--     so five times per row; fn_pending_orders walks its `pending` CTE twice.
--
--  2. fn_aging_bucket / fn_health_label are SQL functions carrying a
--     `SET search_path` clause. That clause is correct and stays -- but it
--     also makes them ineligible for Postgres's SQL-function inliner, so each
--     call is a real function invocation (~31us). At 118,763 rows x 5 that is
--     most of fn_ar_aging's 12 seconds.
--
--  3. fn_dashboard_trend ran three correlated subqueries per day in the range:
--     365 days x 3 = 1,095 full scans of 120,000-row tables for one chart.
--
-- Every rewrite below was proven output-identical against the version it
-- replaces on that loaded branch before being written here (EXCEPT ALL both
-- ways = 0 rows; fn_owner_dashboard compared as whole jsonb across four
-- p_line/date-range combinations). The `bucket`/`label` CASE expressions are
-- copied verbatim from fn_aging_bucket / fn_health_label, including the
-- explicit `at time zone 'UTC'`, so the bucket boundaries do not move and the
-- result does not depend on the session's TimeZone. fn_aging_bucket and
-- fn_health_label themselves are kept -- they are still the single definition
-- of the rule and are still called wherever the row count is bounded.
--
-- After:
--   fn_dashboard_trend(365 days)     402 ms  (80x; and a 10-year range is 637 ms)
--   fn_ar_aging                      673 ms  (18x)
--   fn_owner_dashboard             2,022 ms  (2.7x)
--   fn_dashboard_payment_followups   996 ms
--   fn_dashboard_job_status        1,621 ms
--   fn_pending_orders                711 ms

-- ---------------------------------------------------------------------------
-- 1. fn_aging_bucket: declared IMMUTABLE, but it calls now()
-- ---------------------------------------------------------------------------
-- IMMUTABLE promises the same input always yields the same output, which lets
-- Postgres fold the call to a constant at plan time and cache that plan. This
-- function's answer changes with the clock, so the promise is false: a plan
-- cached before midnight could keep reporting yesterday's bucket. STABLE is
-- the correct label (constant within one statement, not across statements) and
-- is what now() itself is. No caller is affected -- it is used only in query
-- predicates and select lists, never in an index or a generated column, so
-- nothing needs rebuilding.
create or replace function public.fn_aging_bucket(p_due date)
returns text
language sql
stable
set search_path to 'public'
as $function$
  select case
    when floor(extract(epoch from (now() - (p_due::timestamp at time zone 'UTC'))) / 86400) <= 0  then 'current'
    when floor(extract(epoch from (now() - (p_due::timestamp at time zone 'UTC'))) / 86400) <= 30 then 'd1_30'
    when floor(extract(epoch from (now() - (p_due::timestamp at time zone 'UTC'))) / 86400) <= 60 then 'd31_60'
    when floor(extract(epoch from (now() - (p_due::timestamp at time zone 'UTC'))) / 86400) <= 90 then 'd61_90'
    else 'd90_plus'
  end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. AR / AP aging
-- ---------------------------------------------------------------------------
-- The overdue distance is computed once per row, as an integer, in a
-- MATERIALIZED CTE; the five buckets then FILTER on that integer instead of
-- re-deriving a text bucket five times. The expression is fn_aging_bucket's
-- own, lifted verbatim, so the boundaries are unchanged:
--   <= 0 current | 1-30 | 31-60 | 61-90 | > 90
create or replace function public.fn_ar_aging()
returns table(party_id uuid, name text, bucket_current numeric, bucket_1_30 numeric,
              bucket_31_60 numeric, bucket_61_90 numeric, bucket_90_plus numeric, total numeric)
language sql
stable
set search_path to 'public'
as $function$
  with aged as materialized (
    select p.id as party_id,
           p.legal_name,
           o.outstanding_amount,
           floor(extract(epoch from (now() - (((i.invoice_date + coalesce(p.credit_days, 0))::date)::timestamp at time zone 'UTC'))) / 86400)::bigint as days_late
    from public.invoice_outstanding o
    join public.invoices i on i.id = o.invoice_id
    join public.parties p on p.id = o.party_id
    where o.outstanding_amount > 0
  )
  select party_id,
         legal_name,
         coalesce(sum(outstanding_amount) filter (where days_late <= 0), 0),
         coalesce(sum(outstanding_amount) filter (where days_late between 1 and 30), 0),
         coalesce(sum(outstanding_amount) filter (where days_late between 31 and 60), 0),
         coalesce(sum(outstanding_amount) filter (where days_late between 61 and 90), 0),
         coalesce(sum(outstanding_amount) filter (where days_late > 90), 0),
         coalesce(sum(outstanding_amount), 0)
  from aged
  group by party_id, legal_name
  order by coalesce(sum(outstanding_amount), 0) desc;
$function$;

-- Same shape, same fix. This one measured fast on the loaded branch only
-- because that fixture has no supplier bills -- it would fail exactly like
-- fn_ar_aging once the payables side carries comparable volume.
create or replace function public.fn_ap_aging()
returns table(party_id uuid, name text, bucket_current numeric, bucket_1_30 numeric,
              bucket_31_60 numeric, bucket_61_90 numeric, bucket_90_plus numeric, total numeric)
language sql
stable
set search_path to 'public'
as $function$
  with aged as materialized (
    select p.id as party_id,
           p.legal_name,
           o.outstanding_amount,
           floor(extract(epoch from (now() - (((b.bill_date + coalesce(p.credit_days, 0))::date)::timestamp at time zone 'UTC'))) / 86400)::bigint as days_late
    from public.supplier_bill_outstanding o
    join public.supplier_bills b on b.id = o.supplier_bill_id
    join public.parties p on p.id = o.supplier_id
    where o.outstanding_amount > 0
  )
  select party_id,
         legal_name,
         coalesce(sum(outstanding_amount) filter (where days_late <= 0), 0),
         coalesce(sum(outstanding_amount) filter (where days_late between 1 and 30), 0),
         coalesce(sum(outstanding_amount) filter (where days_late between 31 and 60), 0),
         coalesce(sum(outstanding_amount) filter (where days_late between 61 and 90), 0),
         coalesce(sum(outstanding_amount) filter (where days_late > 90), 0),
         coalesce(sum(outstanding_amount), 0)
  from aged
  group by party_id, legal_name
  order by coalesce(sum(outstanding_amount), 0) desc;
$function$;
