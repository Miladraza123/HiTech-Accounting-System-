-- Phase 33.05 — /jobs?health=… stops fetching the whole job book
--
-- The Jobs list paginates in the database, except on one path: filtering by
-- health. Health is derived from the clock rather than stored, so the page
-- fetched every job (with its Sales Order, client and warehouse embeds),
-- filtered in JavaScript and sliced the page out of the result -- correct, but
-- on 120,000 jobs that is 69.5 MB of JSON for one 25-row page.
--
-- The filter is expressible in SQL after all: this returns the ids of the
-- matching page, in the same created_at DESC order the list already uses, plus
-- the matching total so the pager still knows how many pages there are. The
-- page then loads full rows for those 25 ids through the same PostgREST select
-- as before, so the rendered table and its embeds are unchanged.
--
-- security invoker (the default) so RLS applies exactly as it did to the
-- .select() this replaces.
--
-- p_health accepts a HealthLabel ('OnTrack' | 'AtRisk' | 'Delayed' |
-- 'Stalled') or 'attention', which is the list page's shorthand for
-- AtRisk-or-Stalled. The CASE is fn_health_label's, lifted verbatim, which is
-- the same rule as computeHealth() in src/lib/orderHealth.ts -- and the page
-- still calls computeHealth() to draw each badge, so one rule stays one rule.
-- A job in a terminal status has no health at all (computeHealth returns null
-- for isOpen === false), so those rows can never match and are excluded.
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
      and (p_status is null or j.status = p_status)
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

grant execute on function public.fn_jobs_by_health(text, text, integer, integer) to authenticated;
