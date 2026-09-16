-- Phase 33.02 — Owner Dashboard at volume
--
-- Companion to 20260916120000. Same measurements, same method: each function
-- below was proven output-identical to the version it replaces on a Supabase
-- branch carrying 1,327,000 rows before being written here.

-- ---------------------------------------------------------------------------
-- fn_dashboard_trend — 32,160 ms -> 402 ms
-- ---------------------------------------------------------------------------
-- The old version ran three correlated subqueries for every day in the range:
-- a 365-day dashboard meant 1,095 separate full scans of the queries,
-- quotations and sales_orders tables to draw one chart, which put it far past
-- the 8-second statement_timeout on the `authenticated` role -- the chart did
-- not render slowly, it errored. Each table is now grouped by UTC day once and
-- the day series is left-joined onto those counts, so the cost no longer grows
-- with the length of the range: a 10-year range measures 637 ms.
--
-- `at time zone 'UTC'`, the `status <> 'Draft'` rule and the p_line rule are
-- carried over unchanged, and days with no activity still come back as 0
-- rather than being dropped, because the day series is still the driving side.
create or replace function public.fn_dashboard_trend(p_line text, p_from date, p_to date)
returns table (day date, queries bigint, quotations bigint, sales_orders bigint)
language sql
security invoker
stable
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

-- ---------------------------------------------------------------------------
-- fn_dashboard_job_status — 1,888 ms -> 1,621 ms, and now deterministic
-- ---------------------------------------------------------------------------
-- The health label was computed twice per row (once to select it, once to sort
-- by it) across every open job; it is now computed once in a subquery. The
-- remaining cost is the scan of the open-job book itself, which no index can
-- avoid because the label is derived from the clock, not stored.
--
-- Behaviour change, deliberate: `j.id` is added as a final tie-break. The old
-- ORDER BY (health rank, then updated_at desc) leaves ties unresolved, so
-- Postgres was free to return a different six rows on each refresh of the same
-- unchanged data. The first two sort keys are untouched -- this only fixes
-- which of several equally-ranked rows is shown.
create or replace function public.fn_dashboard_job_status(p_line text)
returns table (id uuid, job_no text, progress_pct numeric, so_no text, client text, health_label text)
language sql
security invoker
stable
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

-- ---------------------------------------------------------------------------
-- fn_dashboard_pending_delivery — deterministic tie-break only
-- ---------------------------------------------------------------------------
-- 248 ms at volume, so no rewrite needed. It had the same unresolved-tie
-- problem as the two tables above: many sales orders share a po_date, and the
-- six shown could change between refreshes of identical data.
create or replace function public.fn_dashboard_pending_delivery(p_line text)
returns table (so_no text, client text, days integer)
language sql
security invoker
stable
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

-- ---------------------------------------------------------------------------
-- fn_dashboard_payment_followups — 2,065 ms -> 996 ms, and now deterministic
-- ---------------------------------------------------------------------------
-- `fn_aging_bucket(due) <> 'current'` is exactly "overdue by one day or more",
-- so the predicate is expressed directly on the same expression the function
-- computes. Proven on the loaded branch to select the identical row set:
-- 111,820 rows either way, 0 rows differing in either direction.
--
-- Same deliberate tie-break addition: on that fixture all six rows shared one
-- due date with 212 invoices tied at it, so which six appeared was arbitrary.
create or replace function public.fn_dashboard_payment_followups()
returns table (invoice_id uuid, party_id uuid, client text, amount numeric, overdue_days integer)
language sql
security invoker
stable
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
-- fn_pending_orders — 1,301 ms -> 711 ms
-- ---------------------------------------------------------------------------
-- `pending` is read twice (once for the page of rows, once for the totals
-- row), and a plain CTE referenced twice is executed twice -- so the whole
-- 240,000-line join ran twice per page view. MATERIALIZED makes it once.
-- Nothing else changes.
create or replace function public.fn_pending_orders(p_limit integer, p_offset integer)
returns table(so_id uuid, so_no text, client_po_number text, client text, po_date date,
              description text, ordered numeric, delivered numeric, pending_deliver numeric,
              invoiced numeric, pending_invoice numeric, unit text, days integer,
              total_rows bigint, total_pending_deliver numeric)
language sql
stable
set search_path to 'public'
as $function$
  with pending as materialized (
    select so.id as so_id,
           so.so_no,
           so.client_po_number,
           coalesce(p.legal_name, '—') as client,
           so.po_date,
           l.description,
           l.ordered_qty,
           l.delivered_qty,
           l.ordered_qty - l.delivered_qty as pending_deliver,
           l.invoiced_qty,
           l.delivered_qty - l.invoiced_qty as pending_invoice,
           l.unit
    from public.sales_order_lines l
    join public.sales_orders so on so.id = l.sales_order_id
    left join public.parties p on p.id = so.party_id
    where so.status not in ('Cancelled', 'Closed')
      and (l.ordered_qty - l.delivered_qty > 0.001 or l.delivered_qty - l.invoiced_qty > 0.001)
  ),
  totals as (
    select count(*)::bigint as total_rows,
           coalesce(sum(pending_deliver), 0) as total_pending_deliver
    from pending
  )
  select x.so_id, x.so_no, x.client_po_number, x.client, x.po_date, x.description,
         x.ordered_qty, x.delivered_qty, x.pending_deliver, x.invoiced_qty, x.pending_invoice,
         x.unit, public.fn_days_since(x.po_date), t.total_rows, t.total_pending_deliver
  from pending x, totals t
  order by x.po_date asc
  offset p_offset
  limit p_limit;
$function$;
