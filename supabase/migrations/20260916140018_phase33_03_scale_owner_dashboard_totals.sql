-- Phase 33.03 — fn_owner_dashboard at volume: 5,373 ms -> 2,022 ms
--
-- Companion to 20260916120000 / 20260916121000.
--
-- The tile counts were correct; the shape was the problem. so_health,
-- job_health and po_health are plain CTEs, and a plain CTE is re-executed at
-- every reference. Counting the references: all_health reads all three and is
-- itself read three times (on_track / attention / delayed), job_health is read
-- twice more (job_delayed, fabrication_pending), so_health and po_health once
-- more each. Net effect on a book of 100,000 open jobs and 120,000 sales
-- orders: job_health was built five times and so_health four, each build
-- calling fn_health_label once per row. `overdue` was likewise built twice
-- (overdue_invoice_count, accounts_pending_count), each build calling
-- fn_aging_bucket across 118,763 outstanding invoices.
--
-- fn_health_label and fn_aging_bucket both carry `SET search_path`, which is
-- correct and is kept -- but it also blocks Postgres's SQL-function inliner,
-- so every one of those calls is a real invocation. That is where the five
-- seconds went.
--
-- Two changes, no change in meaning:
--   * every multiply-referenced CTE is MATERIALIZED, so it is built once;
--   * the three health CTEs are pre-aggregated to (label, count) once, and the
--     six health tiles read those counts instead of re-scanning rows.
-- The label and bucket CASE expressions are lifted verbatim from
-- fn_health_label / fn_aging_bucket (same `at time zone 'UTC'`, same
-- boundaries), so the tiles cannot drift from the functions they came from.
-- `fn_aging_bucket(due) <> 'current'` is written out as "overdue by a day or
-- more", which is the same predicate -- verified on the loaded branch to
-- select the identical 111,820 rows, 0 differing either way.
--
-- Verified output-identical to the previous definition as whole jsonb across
-- p_line = combined / material_supply / fabrication and date ranges of 30
-- days, 1 year and 10 years: every key equal in every case.
create or replace function public.fn_owner_dashboard(p_line text, p_from date, p_to date)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
with
so_health as materialized (
  select case
    when so.delivery_schedule is not null
         and floor(extract(epoch from ((so.delivery_schedule::timestamp at time zone 'UTC') - now())) / 86400) < 0 then 'Delayed'
    when so.delivery_schedule is not null
         and floor(extract(epoch from ((so.delivery_schedule::timestamp at time zone 'UTC') - now())) / 86400) <= 3 then 'AtRisk'
    when floor(extract(epoch from (now() - so.updated_at)) / 86400) > 10 then 'Stalled'
    else 'OnTrack' end as label
  from public.sales_orders so
  where (p_line = 'combined' or so.business_line = p_line)
    and so.status not in ('Delivered','Invoiced','Closed','Cancelled')
),
job_health as materialized (
  select case
    when j.required_delivery_date is not null
         and floor(extract(epoch from ((j.required_delivery_date::timestamp at time zone 'UTC') - now())) / 86400) < 0 then 'Delayed'
    when j.required_delivery_date is not null
         and floor(extract(epoch from ((j.required_delivery_date::timestamp at time zone 'UTC') - now())) / 86400) <= 3 then 'AtRisk'
    when floor(extract(epoch from (now() - j.updated_at)) / 86400) > 10 then 'Stalled'
    else 'OnTrack' end as label
  from public.jobs j
  where p_line <> 'material_supply'
    and j.status not in ('Delivered','Cancelled')
),
po_health as materialized (
  select case
    when po.expected_delivery is not null
         and floor(extract(epoch from ((po.expected_delivery::timestamp at time zone 'UTC') - now())) / 86400) < 0 then 'Delayed'
    when po.expected_delivery is not null
         and floor(extract(epoch from ((po.expected_delivery::timestamp at time zone 'UTC') - now())) / 86400) <= 3 then 'AtRisk'
    when floor(extract(epoch from (now() - po.updated_at)) / 86400) > 10 then 'Stalled'
    else 'OnTrack' end as label
  from public.purchase_orders po
  where po.status not in ('Received','Closed','Cancelled')
),
so_counts  as materialized (select label, count(*) as n from so_health  group by label),
job_counts as materialized (select label, count(*) as n from job_health group by label),
po_counts  as materialized (select label, count(*) as n from po_health  group by label),
all_counts as materialized (
  select label, sum(n) as n
  from (select * from so_counts union all select * from job_counts union all select * from po_counts) u
  group by label
),
quotes_sent as materialized (
  select q.id from public.quotations q
  where q.status <> 'Draft'
    and (q.created_at at time zone 'UTC')::date between p_from and p_to
),
overdue as materialized (
  select o.invoice_id, p.id as party_id
  from public.invoice_outstanding o
  join public.invoices i on i.id = o.invoice_id
  join public.parties p on p.id = i.party_id
  where o.outstanding_amount > 0
    and floor(extract(epoch from (now() - (((i.invoice_date + coalesce(p.credit_days, 0))::date)::timestamp at time zone 'UTC'))) / 86400) > 0
),
pending_lines as materialized (
  select l.ordered_qty - l.delivered_qty as pending_deliver,
         l.delivered_qty - l.invoiced_qty as pending_invoice
  from public.sales_order_lines l
  join public.sales_orders so on so.id = l.sales_order_id
  where so.status not in ('Cancelled','Closed')
    and (p_line = 'combined' or so.business_line = p_line)
)
select jsonb_build_object(
  'queries_in_range', (select count(*) from public.queries q
                       where (q.created_at at time zone 'UTC')::date between p_from and p_to),
  'quotations_sent_in_range', (select count(*) from quotes_sent),
  'sales_orders_in_range', (select count(*) from public.sales_orders s
                            where (p_line = 'combined' or s.business_line = p_line)
                              and (s.created_at at time zone 'UTC')::date between p_from and p_to),
  'converted_in_range', (select count(*) from public.sales_orders s
                         where s.status <> 'Cancelled' and s.quotation_id in (select id from quotes_sent)),
  'payments_received_total', (select coalesce(sum(pay.amount), 0) from public.payments pay
                              where pay.direction = 'receipt' and pay.status = 'Posted'
                                and (pay.created_at at time zone 'UTC')::date between p_from and p_to),
  'pending_deliver_count', (select count(*) from pending_lines where pending_deliver > 0.001),
  'pending_invoice_count', (select count(*) from pending_lines where pending_invoice > 0.001),
  'receivables_total', (select coalesce(sum(o.outstanding_amount), 0)
                        from public.invoice_outstanding o
                        left join public.invoices i on i.id = o.invoice_id
                        left join public.sales_orders so on so.id = i.sales_order_id
                        where o.outstanding_amount > 0
                          and (p_line = 'combined' or so.business_line = p_line)),
  'payables_total', (select coalesce(sum(outstanding_amount), 0) from public.supplier_bill_outstanding),
  'cash_balance', (select coalesce(max(balance), 0) from public.cash_in_hand_balance),
  'bank_total', (select coalesce(sum(balance), 0) from public.bank_account_balances where is_active),
  'petty_total', (select coalesce(sum(balance), 0) from public.petty_cash_fund_balances where is_active),
  'stock_value_total', (select coalesce(sum(stock_value), 0) from public.current_stock),
  'overdue_invoice_count', (select count(*) from overdue),
  'accounts_pending_count', (select count(distinct party_id) from overdue),
  'credit_warning_count', (select count(*) from public.parties p
                           left join public.party_ar_summary s on s.party_id = p.id
                           where p.party_type in ('client','both') and p.credit_limit > 0
                             and coalesce(s.total_outstanding, 0) / p.credit_limit >= 0.9),
  'quotation_followup_count', (select count(*) from public.quotations q
                               join public.queries qr on qr.id = q.query_id
                               where q.status = 'Sent'
                                 and qr.next_followup_at is not null
                                 and qr.next_followup_at <= current_date),
  'shortage_item_count', (select count(distinct r.item_id)
                          from public.job_material_requirements r
                          join public.jobs j on j.id = r.job_id
                          where p_line <> 'material_supply'
                            and r.source = 'stock' and j.status = 'MaterialPending'
                            and r.required_qty - r.reserved_qty - r.issued_qty > 0.001),
  'on_track_count', (select coalesce(sum(n), 0) from all_counts where label = 'OnTrack'),
  'attention_count', (select coalesce(sum(n), 0) from all_counts where label in ('AtRisk','Stalled')),
  'delayed_count', (select coalesce(sum(n), 0) from all_counts where label = 'Delayed'),
  'job_delayed_count', (select coalesce(sum(n), 0) from job_counts where label = 'Delayed'),
  'delivery_overdue_count', (select coalesce(sum(n), 0) from so_counts where label = 'Delayed'),
  'material_pending_job_count', (select count(*) from public.jobs j
                                 where p_line <> 'material_supply' and j.status = 'MaterialPending'),
  'client_acceptance_pending_count', (select count(*) from public.delivery_challans d
                                      where d.status = 'Issued' and d.acceptance_status = 'Pending'),
  'open_po_count', (select coalesce(sum(n), 0) from po_counts),
  'fabrication_pending_count', (select coalesce(sum(n), 0) from job_counts where label in ('AtRisk','Stalled','Delayed')),
  'client_pending_count', (select count(*) from public.quotations q where q.status = 'Sent'),
  'active_material_supply_so_count', (select count(*) from public.sales_orders s
                                      where s.business_line = 'material_supply'
                                        and s.status not in ('Delivered','Invoiced','Closed','Cancelled')),
  'active_fabrication_job_count', (select count(*) from public.jobs j
                                   where j.status not in ('Delivered','Cancelled'))
);
$function$;
