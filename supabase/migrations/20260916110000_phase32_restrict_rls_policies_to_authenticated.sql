-- Close an unauthenticated read hole.
--
-- In Postgres, CREATE POLICY ... USING (true) with no TO clause defaults to
-- TO public, which means EVERY role -- including `anon`, the role PostgREST
-- uses for any request carrying only the publishable anon key. That key ships
-- in the browser bundle by design, so "anon" is effectively "anyone on the
-- internet".
--
-- 17 tables were created that way while the rest of the schema correctly says
-- TO authenticated. Verified by becoming the anon role with no JWT, exactly as
-- PostgREST does: bank_accounts returned 2 rows including a real account
-- number, plus daily_snapshots 21, role_permissions 19, expenses 4,
-- petty_cash_funds 3, sales_returns 2, tasks 2, contra_transfers 1, vehicles 1.
--
-- Writes were never exposed -- every INSERT/UPDATE/DELETE policy carries a real
-- is_owner()/has_role() condition -- so this was disclosure, not tampering.
-- Those write policies are realigned here too, so a denied write fails as a
-- clean RLS denial rather than "permission denied for function is_owner".
--
-- Nothing in the application reads these tables before login: proxy.ts only
-- calls auth.getUser(), the login and signup pages query no tables at all, and
-- /api/company-logo uses the service role, which bypasses RLS entirely.
--
-- Written as a loop rather than 44 hand-written ALTERs so that no policy is
-- missed, and so re-running it is a no-op once every policy is already
-- restricted.
do $$
declare
  p record;
  moved int := 0;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and roles::text = '{public}'
    order by tablename, policyname
  loop
    execute format(
      'alter policy %I on %I.%I to authenticated',
      p.policyname, p.schemaname, p.tablename
    );
    moved := moved + 1;
  end loop;

  raise notice 'restricted % policies from public to authenticated', moved;
end $$;

-- Fail the migration loudly if anything was left behind.
do $$
declare leftover int;
begin
  select count(*) into leftover
  from pg_policies
  where schemaname = 'public' and roles::text = '{public}';

  if leftover > 0 then
    raise exception 'still % policies granted to public in the public schema', leftover;
  end if;
end $$;
