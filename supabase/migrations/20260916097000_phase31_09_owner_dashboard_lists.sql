-- Phase 31.09 — Owner Dashboard trend + short tables
--
-- All security invoker (the default): same RLS as the .select() calls they
-- replace.

-- Per-day counts for the dashboard trend chart. The page used to fetch every
-- query, quotation and sales order ever created just to bucket their
-- created_at values; these are the same counts, grouped by UTC day in the
-- database, which the page then folds into its existing time buckets
-- (daily up to 31 days, weekly beyond — that bucketing logic is unchanged).
create or replace function public.fn_dashboard_trend(p_line text, p_from date, p_to date)
returns table (day date, queries bigint, quotations bigint, sales_orders bigint)
language sql
security invoker
stable
as $$
  with days as (select generate_series(p_from, p_to, interval '1 day')::date as d)
  select d.d,
    (select count(*) from public.queries q
      where (q.created_at at time zone 'UTC')::date = d.d),
    (select count(*) from public.quotations q
      where q.status <> 'Draft' and (q.created_at at time zone 'UTC')::date = d.d),
    (select count(*) from public.sales_orders s
      where (p_line = 'combined' or s.business_line = p_line)
        and (s.created_at at time zone 'UTC')::date = d.d)
  from days d
  order by d.d;
$$;

grant execute on function public.fn_dashboard_trend(text, date, date) to authenticated;

-- The dashboard's three short tables each showed only six rows but were fed
-- by a full table fetch. These return exactly those six, in the order the
-- page applied in JS.

-- Job status: ordered by health rank (Delayed, Stalled, AtRisk, OnTrack),
-- matching HEALTH_RANK in the page.
create or replace function public.fn_dashboard_job_status(p_line text)
returns table (id uuid, job_no text, progress_pct numeric, so_no text, client text, health_label text)
language sql
security invoker
stable
as $$
  select j.id, j.job_no, j.progress_pct, so.so_no,
         coalesce(p.legal_name, '—'),
         public.fn_health_label(j.required_delivery_date, j.updated_at)
  from public.jobs j
  left join public.sales_orders so on so.id = j.sales_order_id
  left join public.parties p on p.id = so.party_id
  where p_line <> 'material_supply'
    and j.status not in ('Delivered','Cancelled')
  order by case public.fn_health_label(j.required_delivery_date, j.updated_at)
             when 'Delayed' then 0 when 'Stalled' then 1 when 'AtRisk' then 2 else 3 end,
           j.updated_at desc
  limit 6;
$$;

grant execute on function public.fn_dashboard_job_status(text) to authenticated;

-- Pending deliveries: the page sorted by days-since-PO descending, which is
-- po_date ascending.
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
  order by so.po_date asc
  limit 6;
$$;

grant execute on function public.fn_dashboard_pending_delivery(text) to authenticated;

-- Payment follow-ups: overdue invoices, sorted by overdue days descending,
-- which is due date ascending.
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
    and public.fn_aging_bucket((i.invoice_date + coalesce(p.credit_days, 0))::date) <> 'current'
  order by (i.invoice_date + coalesce(p.credit_days, 0)) asc
  limit 6;
$$;

grant execute on function public.fn_dashboard_payment_followups() to authenticated;
