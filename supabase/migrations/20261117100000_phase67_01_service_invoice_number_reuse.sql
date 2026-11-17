-- Phase 67.01: a cancelled Service Invoice (SRB) number can be used again.
--
-- Same behaviour GST Invoices already have (phase 49): the number of a Cancelled Service Invoice stays
-- on that cancelled record, and while no Posted Service Invoice holds it, the Owner/Accounts can pick it
-- for a new invoice instead of the normal next number.
--   * The unique rule on invoice_no applies to Posted invoices only (a cancelled and a Posted invoice may
--     share a number; two Posted ones never can).
--   * fn_get_available_service_invoice_numbers lists the choices: the next number plus every reusable
--     cancelled number.
--   * fn_create_service_invoice accepts an optional invoice number; omitted, it works exactly as before.
--   * The automatic next number skips any number a Posted Service Invoice already holds (as INV does).
-- No existing invoice, journal or amount is changed.

alter table public.service_invoices drop constraint if exists service_invoices_invoice_no_key;
drop index if exists public.service_invoices_invoice_no_key;
create unique index if not exists service_invoices_invoice_no_posted_key
  on public.service_invoices (invoice_no) where status = 'Posted';

create or replace function public._fn_number_in_use(p_doc_type text, p_number text)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select (p_doc_type in ('INV', 'SRB')
          and exists (select 1 from public.invoices where invoice_no = p_number and status = 'Posted'))
      or (p_doc_type = 'SVI'
          and exists (select 1 from public.service_invoices where invoice_no = p_number and status = 'Posted'));
$fn$;
revoke all on function public._fn_number_in_use(text, text) from public, anon, authenticated;

create or replace function public.fn_get_available_service_invoice_numbers()
returns table(invoice_no text, kind text)
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Service Invoice bana sakte hain.';
  end if;

  return query select public.fn_peek_next_number('SVI'), 'sequential'::text;

  return query
    select distinct i.invoice_no, 'reclaimed'::text
    from public.service_invoices i
    where i.status = 'Cancelled'
      and i.invoice_no not like '%(cancelled)%'   -- numbers already renamed by hand are not offered
      and not exists (select 1 from public.service_invoices p where p.invoice_no = i.invoice_no and p.status = 'Posted')
    order by 1;
end;
$fn$;
revoke all on function public.fn_get_available_service_invoice_numbers() from public, anon;
grant execute on function public.fn_get_available_service_invoice_numbers() to authenticated;

drop function if exists public.fn_create_service_invoice(uuid, date, jsonb);

create or replace function public.fn_create_service_invoice(p_service_job_id uuid, p_invoice_date date, p_lines jsonb, p_invoice_no text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_job record;
  v_invoice_id uuid;
  v_invoice_no text;
  v_line jsonb;
  v_qty numeric;
  v_rate numeric;
  v_tax_pct numeric;
  v_amount numeric;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_sort int := 0;
  v_lines jsonb := '[]'::jsonb;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Service Invoice bana sakte hain.';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Invoice mein kam az kam ek line honi chahiye.';
  end if;

  select * into v_job from public.service_jobs where id = p_service_job_id for update;
  if v_job.id is null then
    raise exception 'Service Job nahi mili.';
  end if;
  if v_job.status = 'Cancelled' then
    raise exception 'Cancelled Service Job par invoice nahi ban sakti.';
  end if;

  if p_invoice_no is not null and btrim(p_invoice_no) <> '' then
    -- a number picked by hand: only one that no Posted Service Invoice holds, and that belongs to the SRB series
    v_invoice_no := btrim(p_invoice_no);
    if exists (select 1 from public.service_invoices where invoice_no = v_invoice_no and status = 'Posted') then
      raise exception 'Invoice number % is already in use.', v_invoice_no;
    end if;
    if not exists (select 1 from public.service_invoices where invoice_no = v_invoice_no and status = 'Cancelled')
       and v_invoice_no <> public.fn_peek_next_number('SVI') then
      raise exception 'Invoice number % is not available. Choose the next number or a cancelled invoice''s number.', v_invoice_no;
    end if;
  else
    select public.fn_get_next_number('SVI') into v_invoice_no;
  end if;

  insert into public.service_invoices (invoice_no, service_job_id, party_id, invoice_date, created_by)
  values (v_invoice_no, p_service_job_id, v_job.party_id, coalesce(p_invoice_date, current_date), auth.uid())
  returning id into v_invoice_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce(trim(v_line->>'description'), '') = '' then
      raise exception 'Har line ka description zaroori hai.';
    end if;
    v_qty := coalesce((v_line->>'qty')::numeric, 1);
    if v_qty <= 0 then
      raise exception 'Qty zero se zyada honi chahiye.';
    end if;
    v_rate := coalesce((v_line->>'rate')::numeric, 0);
    v_tax_pct := coalesce((v_line->>'tax_pct')::numeric, 0);
    v_amount := round(v_qty * v_rate, 2);

    insert into public.service_invoice_lines (service_invoice_id, description, qty, rate, tax_pct, sort_order)
    values (v_invoice_id, trim(v_line->>'description'), v_qty, v_rate, v_tax_pct, v_sort);
    v_sort := v_sort + 1;

    v_subtotal := v_subtotal + v_amount;
    v_tax_total := v_tax_total + round(v_amount * v_tax_pct / 100, 2);
  end loop;

  update public.service_invoices
    set subtotal = round(v_subtotal, 2), tax_total = round(v_tax_total, 2), grand_total = round(v_subtotal + v_tax_total, 2)
    where id = v_invoice_id;

  v_lines := v_lines || jsonb_build_object('account_code', '1200', 'party_id', v_job.party_id, 'debit', round(v_subtotal + v_tax_total, 2), 'credit', 0, 'memo', 'Trade Receivables — Service');
  v_lines := v_lines || jsonb_build_object('account_code', '4020', 'party_id', null, 'debit', 0, 'credit', round(v_subtotal, 2), 'memo', 'Service Revenue');
  if v_tax_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '2400', 'party_id', null, 'debit', 0, 'credit', round(v_tax_total, 2), 'memo', 'Output Sales Tax (GST)');
  end if;

  perform public._fn_post_journal_entry_core(
    coalesce(p_invoice_date, current_date), 'Service Invoice ' || v_invoice_no || ' — ' || v_job.job_no, 'service_invoices', v_invoice_id, v_lines
  );

  return v_invoice_id;
end;
$fn$;

revoke all on function public.fn_create_service_invoice(uuid, date, jsonb, text) from public, anon;
grant execute on function public.fn_create_service_invoice(uuid, date, jsonb, text) to authenticated;
