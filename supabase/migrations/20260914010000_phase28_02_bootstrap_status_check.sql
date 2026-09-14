-- Two related bugs in the "is there an Owner?" checks used by
-- src/app/(app)/layout.tsx (the "This system doesn't have an Owner set
-- up yet" banner) and src/app/(app)/bootstrap/page.tsx (whether to show
-- the "Create the System Owner" form at all).
--
-- Bug #1 (the real one — a security-relevant false negative, not just a
-- cosmetic glitch): both pages counted owners with a plain client-side
-- query —
--   supabase.from("user_roles").select("*, roles!inner(code)", { count:
--   "exact", head: true }).eq("roles.code", "owner")
-- — run as the CURRENTLY SIGNED-IN user, subject to user_roles' own RLS
-- select policy: `user_id = auth.uid() OR is_owner() OR has_role('backup')`.
-- For any signed-in user who is themselves neither an Owner nor the
-- backup role (any ordinary Sales/Store/Dispatch/Accounts/Production
-- staff account), that policy hides every OTHER user's row — so the
-- count comes back 0 and both pages concluded "no Owner exists" even
-- when one plainly does, just because the person looking isn't allowed
-- to see that row. Every ordinary staff member saw the "no Owner" banner
-- and could open the full bootstrap page, regardless of whether a real
-- Owner was already assigned.
--
-- Bug #2: bootstrap/page.tsx also had no way to see
-- system_bootstrap.owner_bootstrapped_at (that table has no select
-- policy for `authenticated` at all — see the previous migration; the
-- only access is through fn_bootstrap_owner()'s own SECURITY DEFINER
-- body), so it couldn't tell a genuinely-never-bootstrapped system apart
-- from one that HAS a bootstrap record but has since lost its only Owner
-- (role reassigned/removed) — the second case would still show the full
-- form with an enabled button that is now guaranteed to fail every time
-- with "this system's one-time Owner bootstrap has already been used".
--
-- Both fixed the same way: a minimal SECURITY DEFINER RPC that checks
-- system-wide state directly, bypassing RLS entirely, rather than
-- relying on a client-side query whose visibility depends on who is
-- asking. Each reveals nothing beyond the one boolean the page needs.
create or replace function public.fn_owner_exists()
returns boolean
language sql
security definer
set search_path = 'public'
stable
as $$
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where r.code = 'owner'
  );
$$;

create or replace function public.fn_owner_bootstrap_already_used()
returns boolean
language sql
security definer
set search_path = 'public'
stable
as $$
  select owner_bootstrapped_at is not null from public.system_bootstrap where id = true;
$$;

grant execute on function public.fn_owner_exists() to authenticated;
grant execute on function public.fn_owner_bootstrap_already_used() to authenticated;
