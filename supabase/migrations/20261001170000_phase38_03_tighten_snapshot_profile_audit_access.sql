-- Role-access fixes from an audit of RLS vs. the app's own guards.

-- 1. daily_snapshots holds cash/bank/petty-cash balances, AR/AP totals and
--    daily sales/collections/expenses, all derived from journal_lines, which
--    only Owner/Accounts/Auditor may read. The snapshot was readable by every
--    signed-in role over REST; give it the same audience as journal_lines and
--    the /reports/daily-snapshot page.
alter policy p_select on public.daily_snapshots
  using (public.is_owner() or public.has_role('accounts') or public.has_role('auditor'));

-- 2. profiles' update policy lets a user edit their own row (name, phone),
--    which also let a deactivated user flip is_active back to true via REST
--    while their access token was still valid. Only the Owner may change it.
create or replace function public.fn_guard_profile_is_active()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- auth.uid() is null for service-role/maintenance updates.
  if new.is_active is distinct from old.is_active
     and auth.uid() is not null
     and not public.is_owner() then
    raise exception 'Only the Owner can activate or deactivate a user.';
  end if;
  return new;
end;
$$;

create or replace trigger trg_guard_profile_is_active before update on public.profiles
  for each row execute function public.fn_guard_profile_is_active();

-- 3. fn_log_password_change accepted any subject, so any user could write
--    "password reset for <anyone>" rows into audit_log. A self change must be
--    about the caller; an admin reset must come from the Owner (the only
--    caller, resetUserPasswordAction, runs as the Owner's own session).
create or replace function public.fn_log_password_change(p_subject_user_id uuid, p_self_change boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_self_change and p_subject_user_id is distinct from auth.uid() then
    raise exception 'A self password change can only be logged for your own account.';
  end if;
  if not p_self_change and not public.is_owner() then
    raise exception 'Only the Owner can log a password reset for another user.';
  end if;
  insert into public.audit_log (table_name, row_id, action, field, actor_id)
  values ('auth_password', p_subject_user_id, 'UPDATE', case when p_self_change then 'self_change' else 'admin_reset' end, auth.uid());
end;
$$;
