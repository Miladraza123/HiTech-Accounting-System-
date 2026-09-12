-- Phase 20 — "New User" creation on the Users & Roles page.
--
-- This app has no SUPABASE_SERVICE_ROLE_KEY configured (only the
-- publishable anon key), so there is no way for server-side code to call
-- Supabase's Admin API (`auth.admin.createUser`) to instantly create
-- someone else's login — and one should never be hardcoded into this
-- repo to work around that. Instead, the Owner "invites" a teammate by
-- email + full name + the role(s) they should get; the invite is stored
-- here with the roles pre-selected. When that person visits /signup and
-- creates their own account with the SAME email, `fn_handle_new_user()`
-- (below) automatically applies the pre-selected role(s) the moment
-- their profile is created — they never land on "No role assigned".

create table public.user_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null,
  role_ids uuid[] not null default '{}',
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz
);

comment on table public.user_invites is
  'Pending "add a new user" invites created by the Owner from Setup > Users & Roles. Consumed by fn_handle_new_user() when someone signs up with a matching email.';

-- Only one *live* (not accepted, not revoked) invite per email at a time.
create unique index idx_user_invites_email_live
  on public.user_invites (lower(trim(email)))
  where accepted_at is null and revoked_at is null;

create index idx_user_invites_created_at on public.user_invites (created_at desc);

alter table public.user_invites enable row level security;

-- Only the Owner can ever see the pending-invite list (it holds names/
-- emails of people who don't have accounts yet). All writes go through
-- the SECURITY DEFINER functions below, never a raw table insert/update/
-- delete from the client — so no write policies are defined here at all,
-- which means RLS denies them by default.
create policy p_select on public.user_invites for select to authenticated
  using (public.is_owner());

-- ---------------------------------------------------------------------
-- fn_invite_user — Owner creates a pending invite for a new teammate.
-- ---------------------------------------------------------------------
create or replace function public.fn_invite_user(p_email text, p_full_name text, p_role_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_full_name text := trim(p_full_name);
  v_invite_id uuid;
begin
  if not public.is_owner() then
    raise exception 'You don''t have permission to perform this action.';
  end if;

  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.';
  end if;

  if v_full_name = '' then
    raise exception 'Full name is required.';
  end if;

  if p_role_ids is null or array_length(p_role_ids, 1) is null or array_length(p_role_ids, 1) = 0 then
    raise exception 'Select at least one role for this user.';
  end if;

  if exists (
    select 1 from unnest(p_role_ids) as rid
    where not exists (select 1 from public.roles r where r.id = rid)
  ) then
    raise exception 'One or more selected roles do not exist.';
  end if;

  if exists (select 1 from public.profiles where lower(trim(email)) = v_email) then
    raise exception 'Someone with this email already has an account.';
  end if;

  if exists (
    select 1 from public.user_invites
    where lower(trim(email)) = v_email and accepted_at is null and revoked_at is null
  ) then
    raise exception 'An invite for this email is already pending.';
  end if;

  insert into public.user_invites (email, full_name, role_ids, invited_by)
  values (v_email, v_full_name, p_role_ids, auth.uid())
  returning id into v_invite_id;

  return v_invite_id;
end;
$$;

-- ---------------------------------------------------------------------
-- fn_revoke_invite — Owner cancels a pending invite before it's accepted.
-- ---------------------------------------------------------------------
create or replace function public.fn_revoke_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'You don''t have permission to perform this action.';
  end if;

  update public.user_invites
  set revoked_at = now()
  where id = p_invite_id and accepted_at is null and revoked_at is null;

  if not found then
    raise exception 'This invite is no longer pending.';
  end if;
end;
$$;

revoke execute on function public.fn_invite_user(text, text, uuid[]) from public, anon;
revoke execute on function public.fn_revoke_invite(uuid) from public, anon;
grant execute on function public.fn_invite_user(text, text, uuid[]) to authenticated;
grant execute on function public.fn_revoke_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Extend the existing new-user trigger: after creating the profile,
-- apply any matching pending invite's pre-selected role(s) and mark it
-- accepted. Everyone who ever signs up still gets a profile row exactly
-- as before (this is additive) — someone signing up WITHOUT a matching
-- invite still lands with no role, same as today, waiting on the Owner.
-- ---------------------------------------------------------------------
create or replace function public.fn_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.user_invites%rowtype;
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), new.email);

  select * into v_invite
  from public.user_invites
  where lower(trim(email)) = lower(trim(new.email))
    and accepted_at is null
    and revoked_at is null
  order by created_at desc
  limit 1;

  if found then
    insert into public.user_roles (user_id, role_id, assigned_by)
    select new.id, rid, v_invite.invited_by
    from unnest(v_invite.role_ids) as rid
    on conflict do nothing;

    update public.user_invites set accepted_at = now() where id = v_invite.id;
  end if;

  return new;
end;
$$;
