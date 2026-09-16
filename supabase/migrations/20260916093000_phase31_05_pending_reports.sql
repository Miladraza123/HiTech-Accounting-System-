-- Phase 31.05 — Report performance, part 4: pending orders / pending purchases
--
-- Days since a date, matching the daysSince/daysOverdue helpers these two
-- reports carried: JS parses a bare 'YYYY-MM-DD' as UTC midnight and floors
-- the difference in days, so the SQL interprets the date at UTC midnight too
-- rather than in the session timezone.
create or replace function public.fn_days_since(p_date date)
returns integer
language sql
immutable
as $$
  select case when p_date is null then null
    else floor(extract(epoch from (now() - (p_date::timestamp at time zone 'UTC'))) / 86400)::integer
  end;
$$;

grant execute on function public.fn_days_since(date) to authenticated;

-- /reports/pending-orders fetched every sales order line of every non-closed
-- order and then discarded, in JavaScript, the ones with nothing left to
-- deliver or invoice. That filter lived in the app only because PostgREST
-- cannot express a column-vs-column comparison. Here it is a WHERE clause,
-- so only genuinely pending lines are returned, one page at a time, with the
-- report-wide totals alongside them.
--
-- Sorting: the old code sorted by days-since-PO descending, which is exactly
-- po_date ascending — same order, no date arithmetic needed.
--
-- security invoker: same RLS as the .select() it replaces.
create or replace function public.fn_pending_orders(p_limit int, p_offset int)
returns table (
  so_id uuid,
  so_no text,
  client_po_number text,
  client text,
  po_date date,
  description text,
  ordered numeric,
  delivered numeric,
  pending_deliver numeric,
  invoiced numeric,
  pending_invoice numeric,
  unit text,
  days integer,
  total_rows bigint,
  total_pending_deliver numeric
)
language sql
security invoker
stable
as $$
  with pending as (
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
$$;

grant execute on function public.fn_pending_orders(int, int) to authenticated;

-- /reports/purchase-pending is the same idea on the purchase side: every line
-- of every open PO was fetched and the fully-received ones dropped in JS.
-- Sorting by overdue-days descending with nulls last is exactly
-- expected_delivery ascending nulls last.
create or replace function public.fn_purchase_pending(p_limit int, p_offset int)
returns table (
  po_id uuid,
  po_no text,
  supplier text,
  expected date,
  description text,
  ordered numeric,
  received numeric,
  pending numeric,
  unit text,
  overdue_days integer,
  total_rows bigint
)
language sql
security invoker
stable
as $$
  with pending as (
    select po.id as po_id,
           po.po_no,
           coalesce(p.legal_name, '—') as supplier,
           po.expected_delivery,
           l.description,
           l.ordered_qty,
           l.received_qty,
           l.ordered_qty - l.received_qty as pending,
           l.unit
    from public.purchase_order_lines l
    join public.purchase_orders po on po.id = l.purchase_order_id
    left join public.parties p on p.id = po.supplier_id
    where po.status not in ('Cancelled', 'Closed')
      and l.ordered_qty - l.received_qty > 0.001
  ),
  totals as (select count(*)::bigint as total_rows from pending)
  select x.po_id, x.po_no, x.supplier, x.expected_delivery, x.description,
         x.ordered_qty, x.received_qty, x.pending, x.unit,
         public.fn_days_since(x.expected_delivery), t.total_rows
  from pending x, totals t
  order by x.expected_delivery asc nulls last
  offset p_offset
  limit p_limit;
$$;

grant execute on function public.fn_purchase_pending(int, int) to authenticated;
