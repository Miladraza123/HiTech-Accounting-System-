-- Phase 33.04 — Order Health & Stage Aging report at volume
--
-- /reports/order-health fetched every open Sales Order, Purchase Order and Job
-- with its party embed, ranked them in JavaScript, and rendered all of them in
-- three HTML tables. On the loaded branch that is 100,000 open jobs alone --
-- 16.5 MB of JSON and a 100,000-row table. Nobody reads row 40,000 of a
-- worst-first list, so the report now asks the database for the counts and for
-- the worst N of each kind, which is what the page actually shows.
--
-- security invoker (the default) is deliberate: this replaces plain .select()
-- calls, so it must see exactly the rows RLS would have let the caller see.
--
-- The health CASE is fn_health_label's, lifted verbatim, which is in turn the
-- same rule as computeHealth() in src/lib/orderHealth.ts: past the promised
-- date is Delayed, within 3 days is AtRisk, otherwise more than 10 days since
-- updated_at is Stalled, else OnTrack. `at time zone 'UTC'` matches how
-- JavaScript parses a bare yyyy-mm-dd date, so the browser and the database
-- agree on the boundary. The page still calls computeHealth() itself on the
-- rows it receives, so the badge and its tooltip text keep their single
-- definition in TypeScript -- the database only ranks and counts.
create or replace function public.fn_order_health(p_limit integer)
returns jsonb
language sql
security invoker
stable
set search_path to 'public'
as $function$
with
so as materialized (
  select s.id,
         s.so_no as doc_no,
         coalesce(p.legal_name, '—') as party_name,
         s.status,
         s.delivery_schedule as promised_date,
         s.updated_at,
         case
           when s.delivery_schedule is not null
                and floor(extract(epoch from ((s.delivery_schedule::timestamp at time zone 'UTC') - now())) / 86400) < 0 then 'Delayed'
           when s.delivery_schedule is not null
                and floor(extract(epoch from ((s.delivery_schedule::timestamp at time zone 'UTC') - now())) / 86400) <= 3 then 'AtRisk'
           when floor(extract(epoch from (now() - s.updated_at)) / 86400) > 10 then 'Stalled'
           else 'OnTrack'
         end as health_label
  from public.sales_orders s
  left join public.parties p on p.id = s.party_id
  where s.status not in ('Delivered','Invoiced','Closed','Cancelled')
),
po as materialized (
  select o.id,
         o.po_no as doc_no,
         coalesce(p.legal_name, '—') as party_name,
         o.status,
         o.expected_delivery as promised_date,
         o.updated_at,
         case
           when o.expected_delivery is not null
                and floor(extract(epoch from ((o.expected_delivery::timestamp at time zone 'UTC') - now())) / 86400) < 0 then 'Delayed'
           when o.expected_delivery is not null
                and floor(extract(epoch from ((o.expected_delivery::timestamp at time zone 'UTC') - now())) / 86400) <= 3 then 'AtRisk'
           when floor(extract(epoch from (now() - o.updated_at)) / 86400) > 10 then 'Stalled'
           else 'OnTrack'
         end as health_label
  from public.purchase_orders o
  left join public.parties p on p.id = o.supplier_id
  where o.status not in ('Received','Closed','Cancelled')
),
jb as materialized (
  select j.id,
         j.job_no as doc_no,
         coalesce(p.legal_name, '—') as party_name,
         j.status,
         j.required_delivery_date as promised_date,
         j.updated_at,
         case
           when j.required_delivery_date is not null
                and floor(extract(epoch from ((j.required_delivery_date::timestamp at time zone 'UTC') - now())) / 86400) < 0 then 'Delayed'
           when j.required_delivery_date is not null
                and floor(extract(epoch from ((j.required_delivery_date::timestamp at time zone 'UTC') - now())) / 86400) <= 3 then 'AtRisk'
           when floor(extract(epoch from (now() - j.updated_at)) / 86400) > 10 then 'Stalled'
           else 'OnTrack'
         end as health_label
  from public.jobs j
  left join public.sales_orders s on s.id = j.sales_order_id
  left join public.parties p on p.id = s.party_id
  where j.status not in ('Delivered','Cancelled')
),
everything as materialized (
  select health_label from so union all
  select health_label from po union all
  select health_label from jb
)
select jsonb_build_object(
  -- The three headline counts stay over EVERY open document, not just the
  -- rows listed below -- that is the point of the summary row.
  'delayed_count', (select count(*) from everything where health_label = 'Delayed'),
  'at_risk_count', (select count(*) from everything where health_label = 'AtRisk'),
  'stalled_count', (select count(*) from everything where health_label = 'Stalled'),
  'sales_orders', jsonb_build_object(
    'total', (select count(*) from so),
    'rows', coalesce((select jsonb_agg(r) from (
        select id, doc_no, party_name, status, promised_date, updated_at
        from so
        -- Same ordering the page applied in JS: worst health first, then
        -- longest time sitting in the current stage. `id` breaks ties so the
        -- list does not reshuffle between two views of unchanged data.
        order by case health_label when 'Delayed' then 0 when 'Stalled' then 1 when 'AtRisk' then 2 else 3 end,
                 updated_at asc, id
        limit p_limit) r), '[]'::jsonb)),
  'purchase_orders', jsonb_build_object(
    'total', (select count(*) from po),
    'rows', coalesce((select jsonb_agg(r) from (
        select id, doc_no, party_name, status, promised_date, updated_at
        from po
        order by case health_label when 'Delayed' then 0 when 'Stalled' then 1 when 'AtRisk' then 2 else 3 end,
                 updated_at asc, id
        limit p_limit) r), '[]'::jsonb)),
  'jobs', jsonb_build_object(
    'total', (select count(*) from jb),
    'rows', coalesce((select jsonb_agg(r) from (
        select id, doc_no, party_name, status, promised_date, updated_at
        from jb
        order by case health_label when 'Delayed' then 0 when 'Stalled' then 1 when 'AtRisk' then 2 else 3 end,
                 updated_at asc, id
        limit p_limit) r), '[]'::jsonb))
);
$function$;

grant execute on function public.fn_order_health(integer) to authenticated;
