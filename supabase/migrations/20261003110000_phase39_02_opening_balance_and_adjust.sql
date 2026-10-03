-- Phase 39.02 — Opening Balance (Party) re-adjustment.
--
-- Setting an opening balance at creation re-uses the existing
-- fn_post_journal_entry RPC directly from createPartyAction (same
-- account pair the Import Wizard's opening_receivables/opening_payables
-- already use: 1200/1900 for a client, 1900/2100 for a supplier) — no new
-- function needed for that half.
--
-- This is the other half: correcting it later. There is no separate
-- "opening_balance" column to update — the balance is purely the sum of
-- journal_lines for that party's receivable/payable account, exactly what
-- fn_party_ledger already reports — so "editing" it means posting a new
-- adjusting entry for the difference, never rewriting the original entry.
-- Computes the current balance itself so the caller never has to (and can
-- never post a stale delta against a balance that moved since they loaded
-- the page).
create or replace function public.fn_adjust_party_balance(
  p_party_id uuid,
  p_direction text,
  p_new_balance numeric,
  p_narration text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current numeric;
  v_delta numeric;
  v_entry_id uuid;
  v_narration text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts may adjust an opening balance.';
  end if;
  if p_direction not in ('receivable', 'payable') then
    raise exception 'Invalid direction.';
  end if;
  if p_new_balance < 0 then
    raise exception 'Balance cannot be negative.';
  end if;

  select coalesce(sum(case when p_direction = 'receivable' then jl.debit - jl.credit else jl.credit - jl.debit end), 0)
    into v_current
  from public.journal_lines jl
  join public.chart_of_accounts coa on coa.id = jl.account_id
  where coa.code = (case when p_direction = 'receivable' then '1200' else '2100' end)
    and jl.party_id = p_party_id;

  v_delta := round(p_new_balance - v_current, 2);
  if v_delta = 0 then
    raise exception 'New balance is the same as the current balance — nothing to adjust.';
  end if;

  v_narration := coalesce(p_narration, 'Opening balance adjustment');

  if p_direction = 'receivable' then
    v_entry_id := public._fn_post_journal_entry_core(
      current_date, v_narration, 'parties', p_party_id,
      case when v_delta > 0 then
        jsonb_build_array(
          jsonb_build_object('account_code', '1200', 'party_id', p_party_id, 'debit', v_delta, 'credit', 0, 'memo', v_narration),
          jsonb_build_object('account_code', '1900', 'party_id', null, 'debit', 0, 'credit', v_delta, 'memo', v_narration)
        )
      else
        jsonb_build_array(
          jsonb_build_object('account_code', '1900', 'party_id', null, 'debit', abs(v_delta), 'credit', 0, 'memo', v_narration),
          jsonb_build_object('account_code', '1200', 'party_id', p_party_id, 'debit', 0, 'credit', abs(v_delta), 'memo', v_narration)
        )
      end
    );
  else
    v_entry_id := public._fn_post_journal_entry_core(
      current_date, v_narration, 'parties', p_party_id,
      case when v_delta > 0 then
        jsonb_build_array(
          jsonb_build_object('account_code', '1900', 'party_id', null, 'debit', v_delta, 'credit', 0, 'memo', v_narration),
          jsonb_build_object('account_code', '2100', 'party_id', p_party_id, 'debit', 0, 'credit', v_delta, 'memo', v_narration)
        )
      else
        jsonb_build_array(
          jsonb_build_object('account_code', '2100', 'party_id', p_party_id, 'debit', abs(v_delta), 'credit', 0, 'memo', v_narration),
          jsonb_build_object('account_code', '1900', 'party_id', null, 'debit', 0, 'credit', abs(v_delta), 'memo', v_narration)
        )
      end
    );
  end if;

  return v_entry_id;
end;
$$;

revoke execute on function public.fn_adjust_party_balance(uuid, text, numeric, text) from public, anon;
grant execute on function public.fn_adjust_party_balance(uuid, text, numeric, text) to authenticated;

-- Read-side companion: the current receivable/payable balance per the same
-- journal_lines definition fn_adjust_party_balance uses, so the Adjust panel
-- always shows (and starts its delta from) the true current figure rather
-- than the invoice-only party_ar_summary/party_ap_summary totals, which
-- don't include a bare opening-balance journal entry.
create or replace function public.fn_party_journal_balance(
  p_party_id uuid,
  p_direction text
)
returns numeric
language sql
security invoker
stable
set search_path = public
as $$
  select coalesce(sum(case when p_direction = 'receivable' then jl.debit - jl.credit else jl.credit - jl.debit end), 0)
  from public.journal_lines jl
  join public.chart_of_accounts coa on coa.id = jl.account_id
  where coa.code = (case when p_direction = 'receivable' then '1200' else '2100' end)
    and jl.party_id = p_party_id;
$$;

grant execute on function public.fn_party_journal_balance(uuid, text) to authenticated;
