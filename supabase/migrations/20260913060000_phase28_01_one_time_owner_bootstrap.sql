-- Security fix: fn_bootstrap_owner() (Phase 0) only ever checked "does
-- an Owner currently exist" — nothing about who is calling it. Any
-- signed-in user (any role, or none) could call it directly, and the
-- moment the Owner count hits 0 for any reason (an Owner accidentally
-- removes their own last Owner role, a bug, a race), literally anyone
-- authenticated could grant themselves Owner. It's meant to solve one
-- real problem — a brand-new deployment has no Owner yet and someone
-- has to become the first one — but that problem only ever needs
-- solving ONCE per deployment, not every time the Owner count happens
-- to be zero.
--
-- This makes it genuinely one-time: a dedicated singleton row tracks
-- whether the bootstrap has ever been consumed, independent of the
-- *current* Owner count (which can legitimately churn — Owners can be
-- deactivated, reassigned, etc.). Once used, it's used for good; a
-- system that later loses its only Owner needs an existing Owner to
-- reassign the role (Setup > Users & Roles) or direct database access
-- — never a same-UI self-promotion by an arbitrary signed-in user.
create table public.system_bootstrap (
  id boolean primary key default true,
  constraint system_bootstrap_singleton check (id = true),
  owner_bootstrapped_at timestamptz
);

alter table public.system_bootstrap enable row level security;
-- No select/write policy for `authenticated` at all — the only access
-- is through fn_bootstrap_owner()'s own SECURITY DEFINER body below.

-- Seed it accurately for every existing deployment reading this
-- migration: if an Owner already exists right now, the one-time
-- bootstrap has already effectively been used (by however this
-- deployment's first Owner actually got their role) — mark it spent.
-- A deployment with no Owner at all right now (including this one, at
-- the exact moment this ships, if that's still true) is seeded as
-- not-yet-used, so the legitimate "restore the very first Owner" path
-- still works exactly once, right now — then locks permanently the
-- moment it succeeds.
insert into public.system_bootstrap (id, owner_bootstrapped_at)
select true, case
  when exists (
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where r.code = 'owner'
  ) then now()
  else null
end;

create or replace function public.fn_bootstrap_owner()
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_owner_role_id uuid;
  v_already_used timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('fn_bootstrap_owner'));

  select owner_bootstrapped_at into v_already_used from public.system_bootstrap where id = true;
  if v_already_used is not null then
    raise exception 'This system''s one-time Owner bootstrap has already been used. If you are locked out, an existing Owner must reassign the Owner role from Setup > Users & Roles.';
  end if;

  select id into v_owner_role_id from public.roles where code = 'owner';
  if exists (select 1 from public.user_roles where role_id = v_owner_role_id) then
    raise exception 'An Owner is already assigned for this system.';
  end if;

  insert into public.user_roles (user_id, role_id, assigned_by)
  values (auth.uid(), v_owner_role_id, auth.uid());

  update public.system_bootstrap set owner_bootstrapped_at = now() where id = true;
end;
$$;
