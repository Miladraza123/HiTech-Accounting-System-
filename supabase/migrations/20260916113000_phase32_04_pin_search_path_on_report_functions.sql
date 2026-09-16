-- Pin search_path on the 21 report/aggregate functions added earlier that were
-- left without one.
--
-- All 21 are SECURITY INVOKER, so a hijacked search_path cannot escalate
-- privileges the way it could in a definer-rights function -- they run with the
-- caller's own rights either way. The real risk here is correctness: an
-- unqualified name inside the body could resolve against a different schema
-- that happens to sit earlier on the caller's search_path, and silently return
-- the wrong figures. These functions compute the P&L, the ledgers, the aging
-- reports and the Owner Dashboard, so "silently wrong numbers" is the failure
-- worth removing.
--
-- Done with ALTER FUNCTION rather than by rewriting the bodies, so not a
-- character of the tested logic changes.
do $$
declare f record; n int := 0;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace nsp on nsp.oid = p.pronamespace
    where nsp.nspname = 'public' and p.prokind = 'f'
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%'
      )
  loop
    execute format('alter function %s set search_path = public', f.sig);
    n := n + 1;
  end loop;
  raise notice 'pinned search_path on % functions', n;
end $$;

do $$
declare leftover int;
begin
  select count(*) into leftover
  from pg_proc p join pg_namespace nsp on nsp.oid = p.pronamespace
  where nsp.nspname = 'public' and p.prokind = 'f'
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%'
    );
  if leftover > 0 then
    raise exception '% functions still have a mutable search_path', leftover;
  end if;
end $$;
