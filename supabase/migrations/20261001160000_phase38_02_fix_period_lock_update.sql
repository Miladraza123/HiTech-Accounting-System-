-- Setting a Period Lock always failed with "UPDATE requires a WHERE clause":
-- Supabase loads pg-safeupdate for API requests, which rejects any UPDATE
-- with no WHERE, and fn_set_period_lock updated the single company row
-- without one. So no lock could ever be saved and backdated entries were
-- never blocked. The company table holds exactly one row; the WHERE only
-- satisfies safeupdate.
create or replace function public.fn_set_period_lock(p_lock_date date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_owner() then
    raise exception 'Only the Owner can set/change the Period Lock.';
  end if;
  update public.company set period_lock_date = p_lock_date where id is not null;
end;
$function$;
