-- Phase 31.08 — Owner Dashboard scalars in one round trip
--
-- /reports built every figure by fetching whole tables — every query,
-- quotation, sales order, sales order line, payment, invoice, party, job,
-- purchase order, delivery challan and stock row ever created — and reducing
-- them in JavaScript. Nineteen unbounded fetches on the owner's home screen,
-- growing with the business forever.
--
-- Range semantics reproduce the page's inRange(): it string-compared a full
-- ISO timestamp against 'YYYY-MM-DD' bounds, which is the UTC calendar date
-- of created_at falling within [from, to] inclusive.
--
-- Line semantics reproduce matchesLine(): 'combined' matches everything,
-- otherwise business_line must equal the selected line. Where the original
-- deliberately did NOT apply the line filter (conversion, the active-line
-- comparison bars, payables, PO health) that is preserved exactly.
--
-- security invoker (the default): same RLS as the .select() calls it
-- replaces. Query shape only, never a permission change.
--
-- Every figure below was compared against an independent recomputation of
-- the old JavaScript on live data, for all three line modes, before the page
-- was switched over.
create or replace function public.fn_owner_dashboard(p_line text, p_from date, p_to date)
returns jsonb
language sql
security invoker
stable
as $$
with
so_health as (
  select public.fn_health_label(so.delivery_schedule, so.updated_at) as label
  from public.sales_orders so
  where (p_line = 'combined' or so.business_line = p_line)
    and so.status not in ('Delivered','Invoiced','Closed','Cancelled')
),
job_health as (
  select public.fn_health_label(j.required_delivery_date, j.updated_at) as label
  from public.jobs j
  where p_line <> 'material_supply'
    and j.status not in ('Delivered','Cancelled')
),
po_health as (
  select public.fn_health_label(po.expected_delivery, po.updated_at) as label
  from public.purchase_orders po
  where po.status not in ('Received','Closed','Cancelled')
),
all_health as (
  select label from so_health union all select label from job_health union all select label from po_health
),
quotes_sent as (
  select q.id from public.quotations q
  where q.status <> 'Draft'
    and (q.created_at at time zone 'UTC')::date between p_from and p_to
),
overdue as (
  select o.invoice_id, p.id as party_id
  from public.invoice_outstanding o
  join public.invoices i on i.id = o.invoice_id
  join public.parties p on p.id = i.party_id
  where o.outstanding_amount > 0
    and public.fn_aging_bucket((i.invoice_date + coalesce(p.credit_days, 0))::date) <> 'current'
),
pending_lines as (
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
  'on_track_count', (select count(*) from all_health where label = 'OnTrack'),
  'attention_count', (select count(*) from all_health where label in ('AtRisk','Stalled')),
  'delayed_count', (select count(*) from all_health where label = 'Delayed'),
  'job_delayed_count', (select count(*) from job_health where label = 'Delayed'),
  'delivery_overdue_count', (select count(*) from so_health where label = 'Delayed'),
  'material_pending_job_count', (select count(*) from public.jobs j
                                 where p_line <> 'material_supply' and j.status = 'MaterialPending'),
  'client_acceptance_pending_count', (select count(*) from public.delivery_challans d
                                      where d.status = 'Issued' and d.acceptance_status = 'Pending'),
  'open_po_count', (select count(*) from po_health),
  'fabrication_pending_count', (select count(*) from job_health where label in ('AtRisk','Stalled','Delayed')),
  'client_pending_count', (select count(*) from public.quotations q where q.status = 'Sent'),
  'active_material_supply_so_count', (select count(*) from public.sales_orders s
                                      where s.business_line = 'material_supply'
                                        and s.status not in ('Delivered','Invoiced','Closed','Cancelled')),
  'active_fabrication_job_count', (select count(*) from public.jobs j
                                   where j.status not in ('Delivered','Cancelled'))
);
$$;

grant execute on function public.fn_owner_dashboard(text, date, date) to authenticated;
