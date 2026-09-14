-- Phase 29.08 — Master Offline-First Roadmap, Phase 8: offline-first
-- Journal Vouchers & remaining admin master data.
--
-- Sub-audit findings (read the actual RPC bodies and every existing
-- edit/create path before writing any code, per this project's own
-- rule):
--
-- 1. Manual Journal Voucher creation (fn_post_journal_entry, delegating
--    to the ungated _fn_post_journal_entry_core) has always generated its
--    journal_entries.id server-side (gen_random_uuid() default) with no
--    way for the caller to supply its own id and no on-conflict handling
--    — a retried call after a dropped connection would post a SECOND
--    entry. Fixed here with fn_post_journal_entry_idempotent, which
--    faithfully mirrors _fn_post_journal_entry_core's insert logic
--    (next-number, journal_entries + journal_lines inserts, same deferred
--    Dr=Cr balance trigger already in place) but takes a client-generated
--    p_id and the standard idempotency guard. Always posts
--    source_table='manual', source_id=null — exactly what
--    createJournalVoucherAction already always passes; a manual JV is
--    never "against" another document. Preserves the pre-existing (not
--    fixed here, out of scope, not blocking) behavior that
--    bank_account_id/petty_cash_fund_id on a line are accepted by the
--    client type but not read by this function — party_id is the only
--    dimension actually posted, exactly like the original.
--
-- 2. Expense Head creation (fn_create_expense_head) has the exact same
--    gap — server-generated id, no idempotency. Fixed with
--    fn_create_expense_head_idempotent, mirroring its chart-of-accounts
--    + expense_heads insert logic with a client id guard on
--    expense_heads (the guard runs before the chart_of_accounts insert
--    too, so a retried/racing call never creates a duplicate GL account
--    either).
--
-- 3. Of every remaining admin master-data table surveyed (expense heads,
--    bank accounts, petty cash funds, chart of accounts, vehicles), only
--    Vehicles has a genuine "free edit anytime" form already shipped
--    (EditVehicleForm.tsx — assigned_user_id/assignment_date/status),
--    currently going through a direct `.update()` call rather than Smart
--    Merge. Widened the Smart Merge allowlist to include it, exactly the
--    same mechanical extension as Phase 1's warehouses addition — no
--    change to the generic engine itself. Expense heads / bank accounts /
--    petty cash funds / chart of accounts have no edit form at all today
--    (only create, already offline for the transactional ones in Phase 5,
--    or newly offline for Expense Head creation in #2 above; and a
--    toggle-active action, deliberately left online-only — a single
--    boolean flip has no established offline precedent anywhere in this
--    roadmap, same category as every other approval/state-toggle action)
--    — there is nothing else to extend. Vehicle *creation* itself
--    (createVehicleAction) goes through a plain direct `.insert()` with
--    no RPC at all, online or offline, in this app's history — inventing
--    one now would be new functionality, not offline-enabling something
--    that already works online, so it's deliberately left out of this
--    phase's scope (noted, not fixed, per this project's "only wire
--    already-existing functionality" discipline).

create or replace function public.fn_post_journal_entry_idempotent(
  p_id uuid,
  p_entry_date date,
  p_narration text,
  p_lines jsonb -- [{account_code, party_id, debit, credit, memo}]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_entry_no text;
  v_line jsonb;
  v_account_id uuid;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts may post journal entries.';
  end if;

  select id into v_existing from public.journal_entries where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if coalesce(trim(p_narration), '') = '' then
    raise exception 'Narration is required.';
  end if;
  if jsonb_array_length(p_lines) < 2 then
    raise exception 'At least 2 lines are required (one Debit, one Credit).';
  end if;

  select public.fn_get_next_number('JV') into v_entry_no;

  insert into public.journal_entries (id, entry_no, entry_date, narration, source_table, source_id, created_by)
  values (p_id, v_entry_no, p_entry_date, p_narration, 'manual', null, auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.journal_entries where id = p_id;
    return v_existing;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select id into v_account_id from public.chart_of_accounts where code = v_line->>'account_code';
    if v_account_id is null then
      raise exception 'Unknown chart of accounts code: %', v_line->>'account_code';
    end if;
    insert into public.journal_lines (journal_entry_id, account_id, party_id, debit, credit, memo)
    values (
      p_id,
      v_account_id,
      nullif(v_line->>'party_id', '')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      v_line->>'memo'
    );
  end loop;

  return p_id;
end;
$$;

revoke execute on function public.fn_post_journal_entry_idempotent(uuid, date, text, jsonb) from public, anon;
grant execute on function public.fn_post_journal_entry_idempotent(uuid, date, text, jsonb) to authenticated;


create or replace function public.fn_create_expense_head_idempotent(
  p_id uuid,
  p_name text,
  p_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_parent_id uuid;
  v_new_account_code text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can create an Expense Head.';
  end if;

  select id into v_existing from public.expense_heads where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'Name is required.';
  end if;
  if exists (select 1 from public.expense_heads where lower(name) = lower(trim(p_name))) then
    raise exception 'This Expense Head already exists.';
  end if;

  select id into v_parent_id from public.chart_of_accounts where code = '6000';
  v_new_account_code := public._fn_next_account_code('6000');

  insert into public.chart_of_accounts (code, name, account_type, parent_id, is_system)
  values (v_new_account_code, trim(p_name) || ' Expense', 'expense', v_parent_id, false);

  insert into public.expense_heads (id, code, name, account_code)
  values (
    p_id,
    coalesce(nullif(upper(trim(p_code)), ''), upper(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '_', 'g'))),
    trim(p_name),
    v_new_account_code
  )
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.expense_heads where id = p_id;
    return v_existing;
  end if;

  return p_id;
end;
$$;

revoke execute on function public.fn_create_expense_head_idempotent(uuid, text, text) from public, anon;
grant execute on function public.fn_create_expense_head_idempotent(uuid, text, text) to authenticated;


-- Phase 1 pattern reused: one line added to the existing allowlist, the
-- generic fn_smart_merge_update engine itself is untouched.
create or replace function public._fn_smart_merge_editable_columns(p_table_name text)
returns text[]
language sql
immutable
set search_path to 'public'
as $function$
  select case p_table_name
    when 'company' then array['legal_name', 'ntn', 'strn', 'address', 'province', 'phone', 'email', 'default_sales_tax_pct']
    when 'parties' then array['credit_limit', 'credit_days']
    when 'warehouses' then array['name', 'address']
    when 'vehicles' then array['assigned_user_id', 'assignment_date', 'status']
    else null
  end;
$function$;
