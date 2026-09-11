-- Postgres views default to running with the view owner's privileges for
-- table access, which can silently bypass the querying user's own RLS.
-- security_invoker = true (PG15+) makes each view enforce RLS as the
-- actual querying user instead — required for every view here since
-- they all sit directly on RLS-protected tables.
alter view public.current_stock set (security_invoker = true);
alter view public.reserved_stock set (security_invoker = true);
alter view public.stock_availability set (security_invoker = true);
