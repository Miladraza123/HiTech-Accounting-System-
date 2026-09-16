-- Follow-up to phase33_05: treat '' the same as NULL for p_status, so the Jobs
-- list can pass its own optional ?status= through without translating an
-- absent filter into a SQL NULL (the generated client types describe every
-- RPC argument as non-null).
create or replace function public.fn_jobs_by_health(
  p_status text,
  p_health text,
  p_limit integer,
  p_offset integer
)
returns table (id uuid, total_rows bigint)
language sql
security invoker
stable
set search_path to 'public'
as $function$
  with labelled as materialized (
    select j.id,
           j.created_at,
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
           end as health_label
    from public.jobs j
    where j.status not in ('Delivered','Cancelled')
      and (p_status is null or p_status = '' or j.status = p_status)
  ),
  matching as materialized (
    select id, created_at
    from labelled
    where case
            when p_health = 'attention' then health_label in ('AtRisk','Stalled')
            else health_label = p_health
          end
  )
  select m.id, (select count(*) from matching) as total_rows
  from matching m
  order by m.created_at desc, m.id
  offset p_offset
  limit p_limit;
$function$;
