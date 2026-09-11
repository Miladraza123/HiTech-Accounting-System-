-- Fix missing search_path (prevents search_path hijacking)
create or replace function public.fn_check_journal_balance()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_je_id uuid;
  v_sum_debit numeric;
  v_sum_credit numeric;
begin
  v_je_id := coalesce(new.journal_entry_id, old.journal_entry_id);
  select coalesce(sum(debit),0), coalesce(sum(credit),0)
    into v_sum_debit, v_sum_credit
    from public.journal_lines where journal_entry_id = v_je_id;
  if v_sum_debit <> v_sum_credit then
    raise exception 'Journal entry % is not balanced: total debit=% total credit=%', v_je_id, v_sum_debit, v_sum_credit;
  end if;
  return null;
end;
$$;

create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Trigger-only functions: nobody should call these directly over the API —
-- Postgres runs trigger functions regardless of the invoking role's own
-- EXECUTE grants, so revoking here only blocks direct RPC misuse.
revoke execute on function public.fn_audit_row() from public, anon, authenticated;
revoke execute on function public.fn_handle_new_user() from public, anon, authenticated;
revoke execute on function public.fn_set_updated_at() from public, anon, authenticated;
revoke execute on function public.fn_check_journal_balance() from public, anon, authenticated;

-- RPC functions: intentionally callable, but only by signed-in users —
-- never by an anonymous visitor.
revoke execute on function public.has_role(text) from public, anon;
revoke execute on function public.is_owner() from public, anon;
revoke execute on function public.fn_bootstrap_owner() from public, anon;
revoke execute on function public.fn_get_next_number(text) from public, anon;
revoke execute on function public.fn_log_login(text, text) from public, anon;
revoke execute on function public.fn_log_logout(uuid) from public, anon;
revoke execute on function public.fn_post_journal_entry(date, text, text, uuid, jsonb) from public, anon;

grant execute on function public.has_role(text) to authenticated;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.fn_bootstrap_owner() to authenticated;
grant execute on function public.fn_get_next_number(text) to authenticated;
grant execute on function public.fn_log_login(text, text) to authenticated;
grant execute on function public.fn_log_logout(uuid) to authenticated;
grant execute on function public.fn_post_journal_entry(date, text, text, uuid, jsonb) to authenticated;
