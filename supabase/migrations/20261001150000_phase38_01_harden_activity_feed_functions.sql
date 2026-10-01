-- Security advisor follow-up for two functions added in phase35.
--
-- fn_log_password_change was created after phase32_03 revoked EXECUTE from
-- PUBLIC on every existing function, so it picked up Postgres's default
-- PUBLIC grant and was callable by the signed-out `anon` role via
-- /rest/v1/rpc/fn_log_password_change (letting anyone write fake
-- "password changed" rows into audit_log). The app only calls it from
-- signed-in server actions, so `authenticated` keeps its explicit grant.
revoke execute on function public.fn_log_password_change(uuid, boolean) from public, anon;

-- describe_login_device had no pinned search_path (the advisor's
-- function_search_path_mutable). It only uses built-ins, so an empty
-- search_path is safe.
alter function public.describe_login_device(text) set search_path = '';
