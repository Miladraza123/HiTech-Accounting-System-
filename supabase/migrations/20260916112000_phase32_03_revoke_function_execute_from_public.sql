-- Defence in depth: stop `anon` from being able to EXECUTE any function in the
-- public schema.
--
-- This was NOT an open door. Each function already guards itself -- probed as
-- the anon role, fn_set_role_permission, fn_create_bank_account,
-- fn_create_payment, fn_create_stock_transfer, fn_create_task and
-- fn_set_period_lock each raised their own "Only Owner ..." / "Sign in
-- required" exception. But a SECURITY DEFINER function runs with the definer's
-- rights, so that internal guard is the ONLY barrier. This adds a second,
-- independent one, as Supabase's linter recommends.
--
-- A first attempt used REVOKE ... FROM anon and achieved nothing for 50
-- functions: their EXECUTE is held by PUBLIC, and revoking from one member of
-- PUBLIC does not touch the PUBLIC grant. Verified afterwards that anon could
-- still execute 50 functions. Recorded here rather than quietly rewritten.
--
-- Order matters: `authenticated` reaches these functions THROUGH the PUBLIC
-- grant, so revoking PUBLIC first would lock the entire application out. Grant
-- explicitly first, then revoke.
--
-- The 11 internal helpers (_fn_* plus the trigger functions fn_audit_row,
-- fn_set_updated_at, fn_check_journal_balance, fn_handle_new_user) are left
-- alone: their ACL is already postgres + service_role only, and a trigger
-- function does not need EXECUTE granted to the invoking role.
--
-- Safe: nothing is called before sign-in. proxy.ts only calls auth.getUser();
-- the login and signup pages call no RPC; fn_owner_exists and
-- fn_owner_bootstrap_already_used are reached only from /bootstrap and the app
-- shell, both behind auth; fn_log_login runs after signInWithPassword has
-- established the session.
do $$
declare
  f record; granted int := 0; before_auth int; after_auth int;
begin
  select count(*) into before_auth
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and has_function_privilege('authenticated', p.oid, 'EXECUTE');

  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
    execute format('revoke execute on function %s from public', f.sig);
    execute format('revoke execute on function %s from anon', f.sig);
    granted := granted + 1;
  end loop;

  select count(*) into after_auth
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and has_function_privilege('authenticated', p.oid, 'EXECUTE');

  if after_auth < before_auth then
    raise exception 'authenticated lost EXECUTE on % functions (% -> %) -- aborting',
      before_auth - after_auth, before_auth, after_auth;
  end if;

  raise notice 'hardened % functions; authenticated still has % (was %)',
    granted, after_auth, before_auth;
end $$;

-- Future functions: no blanket PUBLIC grant, but authenticated and
-- service_role are granted automatically so a newly added RPC is not silently
-- unreachable for the app.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public grant execute on functions to authenticated, service_role;

do $$
declare leftover int;
begin
  select count(*) into leftover
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE');
  if leftover > 0 then
    raise exception 'anon can still execute % functions', leftover;
  end if;
end $$;
