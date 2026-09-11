-- fn_bootstrap_owner had a check-then-act race: two users signing up
-- and calling this within the same instant could both pass the "no
-- Owner yet" check before either transaction commits its insert,
-- resulting in two Owners. Extremely low-likelihood (a one-time,
-- first-ever-signup event) but cheap and precedented to close with the
-- same advisory-lock pattern used elsewhere in this codebase for
-- check-then-act races.
create or replace function public.fn_bootstrap_owner()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_role_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('fn_bootstrap_owner'));

  select id into v_owner_role_id from public.roles where code = 'owner';
  if exists (select 1 from public.user_roles where role_id = v_owner_role_id) then
    raise exception 'An Owner is already assigned for this system.';
  end if;
  insert into public.user_roles (user_id, role_id, assigned_by)
  values (auth.uid(), v_owner_role_id, auth.uid());
end;
$$;
