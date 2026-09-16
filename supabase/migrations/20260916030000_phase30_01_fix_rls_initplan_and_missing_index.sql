-- Phase 30.01 — Performance advisor fixes (no behaviour change)
--
-- Found by mcp__Supabase__get_advisors (performance), verified against the
-- live policy/constraint definitions before writing this migration — not
-- guessed from the advisor's summary text alone.
--
-- 1. auth_rls_initplan on public.tasks (p_insert, p_update): both policies
--    call `auth.uid()` directly. Postgres does NOT automatically cache a
--    bare function call used inside a row filter — it re-invokes it once
--    per row scanned. Wrapping it as `(select auth.uid())` turns it into an
--    uncorrelated scalar subquery, which the planner DOES evaluate once per
--    statement (an InitPlan) and reuse for every row. Same result, same
--    security semantics, only the evaluation frequency changes. `is_owner()`
--    is wrapped the same way for the same reason (it is STABLE and takes no
--    arguments, so it is just as cacheable) even though the advisor's lint
--    only names bare `auth.<fn>()`/`current_setting()` calls, not custom
--    wrappers.
--
-- 2. unindexed_foreign_keys on public.user_invites (user_invites_invited_by_fkey
--    -> auth.users.id): no covering index, so any lookup or join on
--    invited_by is a full table scan. Low-traffic table today, but free to
--    fix and would matter once user_invites has real history.

drop policy if exists p_insert on public.tasks;
create policy p_insert on public.tasks for insert
  with check (created_by = (select auth.uid()));

drop policy if exists p_update on public.tasks;
create policy p_update on public.tasks for update
  using ((select public.is_owner()) or created_by = (select auth.uid()) or assigned_to = (select auth.uid()))
  with check ((select public.is_owner()) or created_by = (select auth.uid()) or assigned_to = (select auth.uid()));

create index if not exists idx_user_invites_invited_by on public.user_invites (invited_by);
