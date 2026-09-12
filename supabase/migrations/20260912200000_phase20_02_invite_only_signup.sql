-- Phase 20 (part 2) — invite-only signup.
--
-- This system is not public: nobody should be able to self-register.
-- The very first account (before any Owner exists) is still allowed
-- through unchanged, so the system can be bootstrapped at all — see
-- /bootstrap + fn_bootstrap_owner(). Every signup after that must match
-- a pending row in user_invites (created by the Owner from Setup >
-- Users & Roles), or the whole signup transaction is rejected — this
-- runs inside the same trigger that creates the profile row, and raising
-- an exception here rolls back the auth.users insert too, so no orphan
-- account is ever created.
create or replace function public.fn_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.user_invites%rowtype;
  v_has_invite boolean;
  v_owner_exists boolean;
begin
  select exists (
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where r.code = 'owner'
  ) into v_owner_exists;

  select * into v_invite
  from public.user_invites
  where lower(trim(email)) = lower(trim(new.email))
    and accepted_at is null
    and revoked_at is null
  order by created_at desc
  limit 1;
  v_has_invite := found;

  if v_owner_exists and not v_has_invite then
    raise exception 'This system is invite-only. Ask the Owner to add you as a new user first.';
  end if;

  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), new.email);

  if v_has_invite then
    insert into public.user_roles (user_id, role_id, assigned_by)
    select new.id, rid, v_invite.invited_by
    from unnest(v_invite.role_ids) as rid
    on conflict do nothing;

    update public.user_invites set accepted_at = now() where id = v_invite.id;
  end if;

  return new;
end;
$$;
