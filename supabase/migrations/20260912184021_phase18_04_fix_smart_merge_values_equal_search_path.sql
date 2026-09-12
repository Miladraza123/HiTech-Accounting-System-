-- get_advisors WARN found immediately after phase18_03:
-- _fn_smart_merge_values_equal was missing `set search_path`, unlike
-- every other function in this schema.
create or replace function public._fn_smart_merge_values_equal(a text, b text)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  na numeric;
  nb numeric;
begin
  if a is null and b is null then return true; end if;
  if a is null or b is null then return false; end if;
  if a = b then return true; end if;
  begin
    na := a::numeric;
    nb := b::numeric;
    return na = nb;
  exception when others then
    return false;
  end;
end;
$function$;
