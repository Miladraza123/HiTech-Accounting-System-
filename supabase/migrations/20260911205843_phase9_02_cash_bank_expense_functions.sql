-- ============================================================
-- Phase 9 (part 2): business functions for Bank Accounts, Petty
-- Cash Funds, Expense Heads, Expenses, Contra Transfers, and the
-- Payments module extended to know which specific bank/petty-cash
-- account a receipt/payment moved through.
-- ============================================================

create or replace function public._fn_next_account_code(p_parent_code text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_parent_id uuid;
  v_max_code int;
begin
  select id into v_parent_id from public.chart_of_accounts where code = p_parent_code;
  if v_parent_id is null then
    raise exception 'Parent account code not found: %', p_parent_code;
  end if;
  select coalesce(max(code::int), (p_parent_code::int)) into v_max_code
    from public.chart_of_accounts where parent_id = v_parent_id;
  return (v_max_code + 1)::text;
end;
$function$;

revoke all on function public._fn_next_account_code(text) from anon, public;

create or replace function public.fn_create_bank_account(
  p_account_name text, p_bank_name text, p_account_number text, p_branch text,
  p_opening_balance numeric default 0, p_opening_balance_date date default current_date
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Bank Account bana sakte hain.';
  end if;
  if coalesce(trim(p_account_name), '') = '' then
    raise exception 'Account name zaroori hai.';
  end if;

  insert into public.bank_accounts (account_name, bank_name, account_number, branch, created_by)
  values (trim(p_account_name), nullif(trim(p_bank_name), ''), nullif(trim(p_account_number), ''), nullif(trim(p_branch), ''), auth.uid())
  returning id into v_id;

  if coalesce(p_opening_balance, 0) <> 0 then
    perform public._fn_post_journal_entry_core(
      coalesce(p_opening_balance_date, current_date), 'Opening Balance — ' || trim(p_account_name), 'bank_accounts', v_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '1100', 'bank_account_id', v_id, 'debit', greatest(p_opening_balance, 0), 'credit', greatest(-p_opening_balance, 0), 'memo', 'Opening Balance'),
        jsonb_build_object('account_code', '1900', 'debit', greatest(-p_opening_balance, 0), 'credit', greatest(p_opening_balance, 0), 'memo', 'Opening Balance Equity')
      )
    );
  end if;

  return v_id;
end;
$function$;

create or replace function public.fn_create_petty_cash_fund(
  p_fund_name text, p_custodian_user_id uuid,
  p_opening_balance numeric default 0, p_opening_balance_date date default current_date
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Petty Cash Fund bana sakte hain.';
  end if;
  if coalesce(trim(p_fund_name), '') = '' then
    raise exception 'Fund name zaroori hai.';
  end if;

  insert into public.petty_cash_funds (fund_name, custodian_user_id, created_by)
  values (trim(p_fund_name), p_custodian_user_id, auth.uid())
  returning id into v_id;

  if coalesce(p_opening_balance, 0) <> 0 then
    perform public._fn_post_journal_entry_core(
      coalesce(p_opening_balance_date, current_date), 'Opening Balance — ' || trim(p_fund_name), 'petty_cash_funds', v_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '1060', 'petty_cash_fund_id', v_id, 'debit', greatest(p_opening_balance, 0), 'credit', greatest(-p_opening_balance, 0), 'memo', 'Opening Balance'),
        jsonb_build_object('account_code', '1900', 'debit', greatest(-p_opening_balance, 0), 'credit', greatest(p_opening_balance, 0), 'memo', 'Opening Balance Equity')
      )
    );
  end if;

  return v_id;
end;
$function$;

create or replace function public.fn_create_expense_head(p_name text, p_code text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_parent_id uuid;
  v_new_account_code text;
  v_head_id uuid;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Expense Head bana sakte hain.';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Naam zaroori hai.';
  end if;
  if exists (select 1 from public.expense_heads where lower(name) = lower(trim(p_name))) then
    raise exception 'Yeh Expense Head pehle se maujood hai.';
  end if;

  select id into v_parent_id from public.chart_of_accounts where code = '6000';
  v_new_account_code := public._fn_next_account_code('6000');

  insert into public.chart_of_accounts (code, name, account_type, parent_id, is_system)
  values (v_new_account_code, trim(p_name) || ' Expense', 'expense', v_parent_id, false);

  insert into public.expense_heads (code, name, account_code)
  values (coalesce(nullif(upper(trim(p_code)), ''), upper(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '_', 'g'))), trim(p_name), v_new_account_code)
  returning id into v_head_id;

  return v_head_id;
end;
$function$;

create or replace function public.fn_create_expense(
  p_expense_date date, p_expense_head_id uuid, p_amount numeric, p_payment_source text,
  p_bank_account_id uuid, p_petty_cash_fund_id uuid, p_job_id uuid, p_responsible_user_id uuid,
  p_department text, p_description text
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_head record;
  v_expense_id uuid;
  v_expense_no text;
  v_credit_account_code text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Expense record kar sakte hain.';
  end if;
  if p_amount <= 0 then
    raise exception 'Amount zero se zyada hona chahiye.';
  end if;
  if p_payment_source not in ('cash', 'bank', 'petty_cash') then
    raise exception 'Payment source ghalat hai.';
  end if;
  if p_payment_source = 'bank' and p_bank_account_id is null then
    raise exception 'Bank Account select karen.';
  end if;
  if p_payment_source = 'petty_cash' and p_petty_cash_fund_id is null then
    raise exception 'Petty Cash Fund select karen.';
  end if;

  select * into v_head from public.expense_heads where id = p_expense_head_id and is_active;
  if v_head.id is null then
    raise exception 'Expense Head nahi mila.';
  end if;

  v_credit_account_code := case p_payment_source when 'bank' then '1100' when 'petty_cash' then '1060' else '1050' end;

  select public.fn_get_next_number('EXP') into v_expense_no;

  insert into public.expenses
    (expense_no, expense_date, expense_head_id, amount, payment_source, bank_account_id, petty_cash_fund_id,
     job_id, responsible_user_id, department, description, created_by)
  values
    (v_expense_no, coalesce(p_expense_date, current_date), p_expense_head_id, p_amount, p_payment_source,
     case when p_payment_source = 'bank' then p_bank_account_id end,
     case when p_payment_source = 'petty_cash' then p_petty_cash_fund_id end,
     p_job_id, p_responsible_user_id, nullif(trim(p_department), ''), nullif(trim(p_description), ''), auth.uid())
  returning id into v_expense_id;

  perform public._fn_post_journal_entry_core(
    coalesce(p_expense_date, current_date), 'Expense ' || v_expense_no || ' — ' || v_head.name, 'expenses', v_expense_id,
    jsonb_build_array(
      jsonb_build_object('account_code', v_head.account_code, 'debit', p_amount, 'credit', 0, 'memo', v_head.name),
      jsonb_build_object(
        'account_code', v_credit_account_code,
        'bank_account_id', case when p_payment_source = 'bank' then p_bank_account_id end,
        'petty_cash_fund_id', case when p_payment_source = 'petty_cash' then p_petty_cash_fund_id end,
        'debit', 0, 'credit', p_amount, 'memo', 'Expense paid'
      )
    )
  );

  return v_expense_id;
end;
$function$;

create or replace function public.fn_cancel_expense(p_expense_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_exp record;
  v_head record;
  v_credit_account_code text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Expense cancel kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancel karne ki wajah likhna zaroori hai.';
  end if;

  select * into v_exp from public.expenses where id = p_expense_id for update;
  if v_exp.id is null then
    raise exception 'Expense nahi mila.';
  end if;
  if v_exp.status = 'Cancelled' then
    raise exception 'Yeh Expense pehle se cancel hai.';
  end if;

  select * into v_head from public.expense_heads where id = v_exp.expense_head_id;
  v_credit_account_code := case v_exp.payment_source when 'bank' then '1100' when 'petty_cash' then '1060' else '1050' end;

  perform public._fn_post_journal_entry_core(
    current_date, 'Expense ' || v_exp.expense_no || ' — cancelled', 'expenses', p_expense_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_code', v_credit_account_code,
        'bank_account_id', v_exp.bank_account_id, 'petty_cash_fund_id', v_exp.petty_cash_fund_id,
        'debit', v_exp.amount, 'credit', 0, 'memo', 'Expense reversed'
      ),
      jsonb_build_object('account_code', v_head.account_code, 'debit', 0, 'credit', v_exp.amount, 'memo', v_head.name || ' — reversed')
    )
  );

  update public.expenses set status = 'Cancelled', cancel_reason = p_reason where id = p_expense_id;
end;
$function$;

create or replace function public.fn_create_contra_entry(
  p_transfer_date date, p_from_type text, p_from_bank_account_id uuid, p_from_petty_cash_fund_id uuid,
  p_to_type text, p_to_bank_account_id uuid, p_to_petty_cash_fund_id uuid, p_amount numeric, p_notes text
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid := gen_random_uuid();
  v_no text;
  v_journal_id uuid;
  v_from_code text;
  v_to_code text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Transfer kar sakte hain.';
  end if;
  if p_amount <= 0 then
    raise exception 'Amount zero se zyada hona chahiye.';
  end if;
  if p_from_type not in ('cash', 'bank', 'petty_cash') or p_to_type not in ('cash', 'bank', 'petty_cash') then
    raise exception 'Transfer type ghalat hai.';
  end if;
  if p_from_type = 'bank' and p_from_bank_account_id is null then
    raise exception 'Source Bank Account select karen.';
  end if;
  if p_from_type = 'petty_cash' and p_from_petty_cash_fund_id is null then
    raise exception 'Source Petty Cash Fund select karen.';
  end if;
  if p_to_type = 'bank' and p_to_bank_account_id is null then
    raise exception 'Destination Bank Account select karen.';
  end if;
  if p_to_type = 'petty_cash' and p_to_petty_cash_fund_id is null then
    raise exception 'Destination Petty Cash Fund select karen.';
  end if;
  if p_from_type = p_to_type
     and coalesce(p_from_bank_account_id, p_from_petty_cash_fund_id) is not distinct from coalesce(p_to_bank_account_id, p_to_petty_cash_fund_id) then
    raise exception 'Source aur Destination same nahi ho sakte.';
  end if;

  v_from_code := case p_from_type when 'bank' then '1100' when 'petty_cash' then '1060' else '1050' end;
  v_to_code := case p_to_type when 'bank' then '1100' when 'petty_cash' then '1060' else '1050' end;

  select public.fn_get_next_number('CT') into v_no;

  v_journal_id := public._fn_post_journal_entry_core(
    coalesce(p_transfer_date, current_date), 'Fund Transfer ' || v_no, 'contra_transfers', v_id,
    jsonb_build_array(
      jsonb_build_object('account_code', v_to_code, 'bank_account_id', p_to_bank_account_id, 'petty_cash_fund_id', p_to_petty_cash_fund_id, 'debit', p_amount, 'credit', 0, 'memo', 'Transfer in'),
      jsonb_build_object('account_code', v_from_code, 'bank_account_id', p_from_bank_account_id, 'petty_cash_fund_id', p_from_petty_cash_fund_id, 'debit', 0, 'credit', p_amount, 'memo', 'Transfer out')
    )
  );

  insert into public.contra_transfers
    (id, transfer_no, transfer_date, from_type, from_bank_account_id, from_petty_cash_fund_id,
     to_type, to_bank_account_id, to_petty_cash_fund_id, amount, notes, journal_entry_id, created_by)
  values
    (v_id, v_no, coalesce(p_transfer_date, current_date), p_from_type, p_from_bank_account_id, p_from_petty_cash_fund_id,
     p_to_type, p_to_bank_account_id, p_to_petty_cash_fund_id, p_amount, nullif(trim(p_notes), ''), v_journal_id, auth.uid());

  return v_id;
end;
$function$;

create or replace function public.fn_cancel_contra_entry(p_transfer_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_t record;
  v_from_code text;
  v_to_code text;
begin
  if not public.is_owner() then
    raise exception 'Sirf Owner Transfer cancel kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancel karne ki wajah likhna zaroori hai.';
  end if;

  select * into v_t from public.contra_transfers where id = p_transfer_id for update;
  if v_t.id is null then
    raise exception 'Transfer nahi mila.';
  end if;
  if v_t.status = 'Cancelled' then
    raise exception 'Yeh Transfer pehle se cancel hai.';
  end if;

  v_from_code := case v_t.from_type when 'bank' then '1100' when 'petty_cash' then '1060' else '1050' end;
  v_to_code := case v_t.to_type when 'bank' then '1100' when 'petty_cash' then '1060' else '1050' end;

  perform public._fn_post_journal_entry_core(
    current_date, 'Fund Transfer ' || v_t.transfer_no || ' — cancelled', 'contra_transfers', p_transfer_id,
    jsonb_build_array(
      jsonb_build_object('account_code', v_from_code, 'bank_account_id', v_t.from_bank_account_id, 'petty_cash_fund_id', v_t.from_petty_cash_fund_id, 'debit', v_t.amount, 'credit', 0, 'memo', 'Transfer reversed'),
      jsonb_build_object('account_code', v_to_code, 'bank_account_id', v_t.to_bank_account_id, 'petty_cash_fund_id', v_t.to_petty_cash_fund_id, 'debit', 0, 'credit', v_t.amount, 'memo', 'Transfer reversed')
    )
  );

  update public.contra_transfers set status = 'Cancelled', cancel_reason = p_reason where id = p_transfer_id;
end;
$function$;

-- ---- Payments module: now knows which specific bank/petty-cash account
-- the money moved through (previously always posted to the combined 1100).
create or replace function public.fn_create_payment(
  p_party_id uuid, p_direction text, p_payment_date date, p_method text, p_reference_no text,
  p_amount numeric, p_notes text, p_allocations jsonb,
  p_bank_account_id uuid default null, p_petty_cash_fund_id uuid default null
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_party record;
  v_payment_id uuid;
  v_payment_no text;
  v_line jsonb;
  v_alloc_total numeric := 0;
  v_outstanding numeric;
  v_cash_account_code text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Payment record kar sakte hain.';
  end if;
  if p_direction not in ('receipt','payment') then
    raise exception 'Direction ghalat hai.';
  end if;
  if p_amount <= 0 then
    raise exception 'Amount zero se zyada hona chahiye.';
  end if;

  select * into v_party from public.parties where id = p_party_id;
  if v_party.id is null then
    raise exception 'Party nahi mili.';
  end if;
  if p_direction = 'receipt' and v_party.party_type not in ('client','both') then
    raise exception 'Yeh party client nahi hai.';
  end if;
  if p_direction = 'payment' and v_party.party_type not in ('supplier','both') then
    raise exception 'Yeh party supplier nahi hai.';
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_alloc_total := v_alloc_total + (v_line->>'amount')::numeric;
  end loop;
  if v_alloc_total > p_amount then
    raise exception 'Allocation total payment amount se zyada nahi ho sakti.';
  end if;

  v_cash_account_code := case
    when p_petty_cash_fund_id is not null then '1060'
    when p_bank_account_id is not null then '1100'
    when p_method ilike 'cash' then '1050'
    else '1100'
  end;

  select public.fn_get_next_number('PAY') into v_payment_no;

  insert into public.payments
    (payment_no, party_id, direction, payment_date, method, reference_no, amount, unallocated_amount, notes,
     bank_account_id, petty_cash_fund_id, created_by)
  values
    (v_payment_no, p_party_id, p_direction, coalesce(p_payment_date, current_date), p_method, p_reference_no,
     p_amount, p_amount - v_alloc_total, p_notes, p_bank_account_id, p_petty_cash_fund_id, auth.uid())
  returning id into v_payment_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    if p_direction = 'receipt' then
      perform pg_advisory_xact_lock(hashtextextended('invoice:' || (v_line->>'invoice_id'), 0));

      select outstanding_amount into v_outstanding from public.invoice_outstanding
        where invoice_id = (v_line->>'invoice_id')::uuid and party_id = p_party_id;
      if v_outstanding is null then
        raise exception 'Invoice is party ki nahi hai ya mili nahi.';
      end if;
      if (v_line->>'amount')::numeric > v_outstanding then
        raise exception 'Allocation outstanding amount se zyada hai (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, invoice_id, amount)
      values (v_payment_id, (v_line->>'invoice_id')::uuid, (v_line->>'amount')::numeric);
    else
      perform pg_advisory_xact_lock(hashtextextended('supplier_bill:' || (v_line->>'supplier_bill_id'), 0));

      select outstanding_amount into v_outstanding from public.supplier_bill_outstanding
        where supplier_bill_id = (v_line->>'supplier_bill_id')::uuid and supplier_id = p_party_id;
      if v_outstanding is null then
        raise exception 'Supplier Bill is party ki nahi hai ya mili nahi.';
      end if;
      if (v_line->>'amount')::numeric > v_outstanding then
        raise exception 'Allocation outstanding amount se zyada hai (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, supplier_bill_id, amount)
      values (v_payment_id, (v_line->>'supplier_bill_id')::uuid, (v_line->>'amount')::numeric);
    end if;
  end loop;

  if p_direction = 'receipt' then
    perform public._fn_post_journal_entry_core(
      coalesce(p_payment_date, current_date), 'Receipt ' || v_payment_no, 'payments', v_payment_id,
      jsonb_build_array(
        jsonb_build_object('account_code', v_cash_account_code, 'bank_account_id', p_bank_account_id, 'petty_cash_fund_id', p_petty_cash_fund_id, 'debit', p_amount, 'credit', 0, 'memo', 'Cash/Bank received'),
        jsonb_build_object('account_code', '1200', 'party_id', p_party_id, 'debit', 0, 'credit', p_amount, 'memo', 'Trade Receivables')
      )
    );
  else
    perform public._fn_post_journal_entry_core(
      coalesce(p_payment_date, current_date), 'Payment ' || v_payment_no, 'payments', v_payment_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '2100', 'party_id', p_party_id, 'debit', p_amount, 'credit', 0, 'memo', 'Trade Payables'),
        jsonb_build_object('account_code', v_cash_account_code, 'bank_account_id', p_bank_account_id, 'petty_cash_fund_id', p_petty_cash_fund_id, 'debit', 0, 'credit', p_amount, 'memo', 'Cash/Bank paid')
      )
    );
  end if;

  return v_payment_id;
end;
$function$;

create or replace function public.fn_cancel_payment(p_payment_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_payment record;
  v_lines jsonb;
  v_cash_account_code text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Payment cancel kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancel karne ki wajah likhna zaroori hai.';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment.id is null then
    raise exception 'Payment nahi mili.';
  end if;
  if v_payment.status = 'Cancelled' then
    raise exception 'Yeh Payment pehle se cancel hai.';
  end if;

  v_cash_account_code := case
    when v_payment.petty_cash_fund_id is not null then '1060'
    when v_payment.bank_account_id is not null then '1100'
    when v_payment.method ilike 'cash' then '1050'
    else '1100'
  end;

  if v_payment.direction = 'receipt' then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '1200', 'party_id', v_payment.party_id, 'debit', v_payment.amount, 'credit', 0, 'memo', 'Trade Receivables — reversed'),
      jsonb_build_object('account_code', v_cash_account_code, 'bank_account_id', v_payment.bank_account_id, 'petty_cash_fund_id', v_payment.petty_cash_fund_id, 'debit', 0, 'credit', v_payment.amount, 'memo', 'Cash/Bank — reversed')
    );
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', v_cash_account_code, 'bank_account_id', v_payment.bank_account_id, 'petty_cash_fund_id', v_payment.petty_cash_fund_id, 'debit', v_payment.amount, 'credit', 0, 'memo', 'Cash/Bank — reversed'),
      jsonb_build_object('account_code', '2100', 'party_id', v_payment.party_id, 'debit', 0, 'credit', v_payment.amount, 'memo', 'Trade Payables — reversed')
    );
  end if;

  perform public._fn_post_journal_entry_core(
    current_date,
    (case when v_payment.direction = 'receipt' then 'Receipt ' else 'Payment ' end) || v_payment.payment_no || ' — cancelled',
    'payments', p_payment_id, v_lines
  );

  update public.payments set status = 'Cancelled', cancel_reason = p_reason where id = p_payment_id;
end;
$function$;

-- ---- Reporting views (security_invoker=true from the start) ----
create view public.bank_account_balances with (security_invoker = true) as
select
  ba.id as bank_account_id,
  ba.account_name,
  ba.bank_name,
  ba.account_number,
  ba.is_active,
  coalesce(sum(jl.debit - jl.credit), 0) as balance
from public.bank_accounts ba
left join public.journal_lines jl on jl.bank_account_id = ba.id
group by ba.id, ba.account_name, ba.bank_name, ba.account_number, ba.is_active;

create view public.petty_cash_fund_balances with (security_invoker = true) as
select
  pf.id as petty_cash_fund_id,
  pf.fund_name,
  pf.custodian_user_id,
  pf.is_active,
  coalesce(sum(jl.debit - jl.credit), 0) as balance
from public.petty_cash_funds pf
left join public.journal_lines jl on jl.petty_cash_fund_id = pf.id
group by pf.id, pf.fund_name, pf.custodian_user_id, pf.is_active;

create view public.cash_in_hand_balance with (security_invoker = true) as
select coalesce(sum(jl.debit - jl.credit), 0) as balance
from public.journal_lines jl
join public.chart_of_accounts coa on coa.id = jl.account_id
where coa.code = '1050';
