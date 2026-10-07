-- Phase 47.05: Import Wizard opening balances, posted by one function.
--
-- Found in the live test of the Import Wizard (2026-10-07):
--  * Uploading the same Opening Receivables / Payables file twice posted
--    every balance twice (the stock import was made idempotent in 46.04,
--    the balance import never was).
--  * Since 46.01 fn_post_journal_entry records every entry it posts as a
--    manual JV, so opening balances lost their link to the import batch.
--  * The party was looked up with ILIKE, where "_" and "%" in a name are
--    wildcards, and a receivable could land on a supplier (or a payable
--    on a client).
--
-- fn_import_opening_balance does the whole row in the database: exact
-- (case-insensitive) name match, party type check, at most one imported
-- opening balance per party and side, and the entry linked to its batch.

create or replace function public.fn_import_opening_balance(
  p_kind text,
  p_party_name text,
  p_amount numeric,
  p_as_of_date date,
  p_narration text,
  p_batch_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_party_name, ''));
  v_party public.parties;
  v_want text;
  v_control text;
  v_entity text;
  v_existing text;
  v_lines jsonb;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can import opening balances.';
  end if;
  if p_kind not in ('receivable', 'payable') or p_kind is null then
    raise exception 'Kind must be receivable or payable.';
  end if;
  if v_name = '' then
    raise exception 'Party name is required.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be more than 0.';
  end if;
  if p_as_of_date is null then
    raise exception 'Date is required.';
  end if;
  if not exists (select 1 from public.import_batches where id = p_batch_id) then
    raise exception 'Import batch not found.';
  end if;

  v_want := case p_kind when 'receivable' then 'client' else 'supplier' end;
  v_control := case p_kind when 'receivable' then '1200' else '2100' end;
  v_entity := case p_kind when 'receivable' then 'opening_receivables' else 'opening_payables' end;

  -- One party at a time, so two uploads running together cannot both pass
  -- the "already imported" check below.
  perform pg_advisory_xact_lock(hashtext('opening_balance:' || p_kind || ':' || lower(v_name)));

  select * into v_party from public.parties where lower(btrim(legal_name)) = lower(v_name);
  if v_party.id is null then
    if not (public.is_owner() or public.has_role('sales') or public.has_role('store')) then
      raise exception '"%" is not in Clients & Suppliers yet, and your role can''t add it — ask the Owner, Sales or Store to add it first.', v_name;
    end if;
    insert into public.parties (legal_name, party_type, created_by)
    values (v_name, v_want, auth.uid())
    returning * into v_party;
  elsif v_party.party_type not in (v_want, 'both') then
    raise exception '"%" is a % — an opening % needs a % (or a party marked as both).',
      v_party.legal_name, v_party.party_type, p_kind, v_want;
  end if;

  select j.entry_no into v_existing
  from public.journal_lines l
  join public.journal_entries j on j.id = l.journal_entry_id
  join public.chart_of_accounts a on a.id = l.account_id
  join public.import_batches b on b.id = j.source_id
  where j.source_table = 'import_batches'
    and b.entity_type = v_entity
    and a.code = v_control
    and l.party_id = v_party.id
  limit 1;
  if v_existing is not null then
    raise exception 'Opening % for "%" was already imported (%). Correct it with a Journal Voucher instead.',
      p_kind, v_party.legal_name, v_existing;
  end if;

  v_lines := case p_kind
    when 'receivable' then jsonb_build_array(
      jsonb_build_object('account_code', '1200', 'party_id', v_party.id, 'debit', round(p_amount, 2), 'credit', 0, 'memo', 'Opening balance'),
      jsonb_build_object('account_code', '1900', 'party_id', null, 'debit', 0, 'credit', round(p_amount, 2), 'memo', 'Opening balance'))
    else jsonb_build_array(
      jsonb_build_object('account_code', '1900', 'party_id', null, 'debit', round(p_amount, 2), 'credit', 0, 'memo', 'Opening balance'),
      jsonb_build_object('account_code', '2100', 'party_id', v_party.id, 'debit', 0, 'credit', round(p_amount, 2), 'memo', 'Opening balance'))
  end;

  return public._fn_post_journal_entry_core(
    p_as_of_date,
    coalesce(nullif(btrim(coalesce(p_narration, '')), ''), 'Opening balance — ' || v_party.legal_name),
    'import_batches', p_batch_id, v_lines);
end;
$$;

revoke execute on function public.fn_import_opening_balance(text, text, numeric, date, text, uuid) from public, anon;
grant execute on function public.fn_import_opening_balance(text, text, numeric, date, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Users & Roles guards (found in the same admin test pass)
-- ---------------------------------------------------------------------------
-- 1. The last Owner role can never be removed. Clicking "Owner ×" on the
--    only Owner used to leave the system with no Owner at all; the one-time
--    bootstrap is already used, so nobody could set Period Lock, users,
--    permissions or backups again without direct database access.
create or replace function public._fn_guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := (select id from public.roles where code = 'owner');
begin
  if old.role_id = v_owner
     and (tg_op = 'DELETE' or new.role_id <> v_owner or new.user_id <> old.user_id)
     and not exists (
       select 1 from public.user_roles ur
       where ur.role_id = v_owner and not (ur.user_id = old.user_id and ur.role_id = old.role_id)
     ) then
    raise exception 'At least one Owner must remain. Give the Owner role to someone else first.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace trigger trg_guard_last_owner before delete or update on public.user_roles
  for each row execute function public._fn_guard_last_owner();

-- 2. A user may edit their own profile (name), but only the Owner may
--    change whether an account is active or which email it shows. Before
--    this, a deactivated user whose session had not yet expired could set
--    is_active back to true through the API.
create or replace function public._fn_guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_owner()
     and (new.is_active is distinct from old.is_active or new.email is distinct from old.email) then
    raise exception 'Only the Owner can change whether an account is active or its email.';
  end if;
  return new;
end;
$$;

create or replace trigger trg_guard_profile_update before update on public.profiles
  for each row execute function public._fn_guard_profile_update();

revoke execute on function public._fn_guard_last_owner() from public, anon, authenticated;
revoke execute on function public._fn_guard_profile_update() from public, anon, authenticated;
