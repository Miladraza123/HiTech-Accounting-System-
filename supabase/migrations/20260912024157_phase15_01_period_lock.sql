-- ============================================================
-- Phase 15 part A: Period Lock. A single company-wide lock date — no
-- journal entry may be posted with entry_date <= period_lock_date once
-- set. Enforced at the ONE true choke point every financial posting in
-- this entire system already goes through (_fn_post_journal_entry_core),
-- rather than repeating the check in 20+ individual fn_create_*/
-- fn_cancel_* functions — this guarantees no future posting function can
-- ever bypass it either. Absolute once set, even for Owner (Owner can
-- always move/clear the date itself first, via fn_set_period_lock,
-- deliberately — same "closing the books" semantics real accounting
-- software uses); the existing trg_audit on `company` already tracks
-- who changed the lock date and when, so no separate history table is
-- needed for that.
-- ============================================================

alter table public.company add column period_lock_date date;

create or replace function public.fn_set_period_lock(p_lock_date date)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_owner() then
    raise exception 'Sirf Owner Period Lock set/change kar sakta hai.';
  end if;
  update public.company set period_lock_date = p_lock_date;
end;
$function$;

create or replace function public._fn_post_journal_entry_core(p_entry_date date, p_narration text, p_source_table text, p_source_id uuid, p_lines jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_entry_id uuid;
  v_entry_no text;
  v_line jsonb;
  v_account_id uuid;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_lock_date date;
begin
  select period_lock_date into v_lock_date from public.company limit 1;
  if v_lock_date is not null and p_entry_date <= v_lock_date then
    raise exception 'Yeh date (%) locked period mein hai (lock: %). Is date par koi nayi entry post nahi ho sakti.', p_entry_date, v_lock_date;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_total_debit := v_total_debit + coalesce((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + coalesce((v_line->>'credit')::numeric, 0);
  end loop;
  if round(v_total_debit - v_total_credit, 2) <> 0 then
    raise exception 'Journal entry balanced nahi hai (Debit: %, Credit: %).', v_total_debit, v_total_credit;
  end if;

  select public.fn_get_next_number('JV') into v_entry_no;

  insert into public.journal_entries (entry_no, entry_date, narration, source_table, source_id, created_by)
  values (v_entry_no, p_entry_date, p_narration, p_source_table, p_source_id, auth.uid())
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select id into v_account_id from public.chart_of_accounts where code = v_line->>'account_code';
    if v_account_id is null then
      raise exception 'Unknown chart of accounts code: %', v_line->>'account_code';
    end if;
    insert into public.journal_lines (journal_entry_id, account_id, party_id, bank_account_id, petty_cash_fund_id, debit, credit, memo)
    values (
      v_entry_id,
      v_account_id,
      nullif(v_line->>'party_id','')::uuid,
      nullif(v_line->>'bank_account_id','')::uuid,
      nullif(v_line->>'petty_cash_fund_id','')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      v_line->>'memo'
    );
  end loop;

  return v_entry_id;
end;
$function$;
