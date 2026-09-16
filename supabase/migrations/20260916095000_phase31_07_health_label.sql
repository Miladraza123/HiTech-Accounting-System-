-- Phase 31.07 — Order health label in SQL
--
-- Expressed exactly as computeHealth() in src/lib/orderHealth.ts does it for
-- an open document:
--
--   if promisedDate:
--     until = floor((Date.parse(promisedDate) - Date.now()) / 86400000)
--     if until < 0  -> 'Delayed'
--     if until <= 3 -> 'AtRisk'
--   stageDays = floor((Date.now() - Date.parse(updatedAt)) / 86400000)
--   if stageDays > 10 -> 'Stalled'
--   else 'OnTrack'
--
-- promisedDate is a bare 'YYYY-MM-DD', which JS parses as UTC midnight, so it
-- is interpreted at UTC midnight here too rather than in the session
-- timezone. updated_at is already an instant, so it needs no such handling.
-- The 3-day AT_RISK window and 10-day STALLED threshold are the constants
-- from that same file.
--
-- Verified against the real computeHealth across both sides of both
-- boundaries (until 0/-1 and 3/4, stageDays 10/11) — all four labels
-- identical.
create or replace function public.fn_health_label(p_promised date, p_updated timestamptz)
returns text
language sql
stable
as $$
  select case
    when p_promised is not null
         and floor(extract(epoch from ((p_promised::timestamp at time zone 'UTC') - now())) / 86400) < 0
      then 'Delayed'
    when p_promised is not null
         and floor(extract(epoch from ((p_promised::timestamp at time zone 'UTC') - now())) / 86400) <= 3
      then 'AtRisk'
    when floor(extract(epoch from (now() - p_updated)) / 86400) > 10
      then 'Stalled'
    else 'OnTrack'
  end;
$$;

grant execute on function public.fn_health_label(date, timestamptz) to authenticated;
