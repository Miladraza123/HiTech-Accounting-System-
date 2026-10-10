-- Invoice-number reuse: a Cancelled invoice's number becomes available
-- for a future Invoice once no Posted invoice holds it. A plain unique
-- constraint on invoice_no can't express that (it has no concept of
-- status), so it's replaced with a partial unique index scoped to
-- Posted rows only -- any number of Cancelled rows may share a number,
-- but only one Posted row may ever hold it at a time.
alter table public.invoices drop constraint invoices_invoice_no_key;
create unique index invoices_invoice_no_posted_key on public.invoices (invoice_no) where status = 'Posted';

-- Read-only preview of what fn_get_next_number('INV') would hand out next,
-- without consuming it (no UPDATE to numbering_sequences) -- needed so the
-- Invoice-number picker can show it as an option alongside reclaimed
-- Cancelled numbers before the user has committed to anything.
create or replace function public.fn_peek_next_number(p_doc_type text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.numbering_sequences%rowtype;
  v_current_fy int;
  v_next_value int;
  v_number text;
begin
  select * into v_row from public.numbering_sequences where doc_type = p_doc_type;
  if not found then
    raise exception 'Unknown document type: %', p_doc_type;
  end if;

  v_current_fy := case when extract(month from current_date) >= 7
                       then extract(year from current_date)::int
                       else extract(year from current_date)::int - 1
                  end;

  if v_row.fy_reset and (v_row.last_reset_fy is distinct from v_current_fy) then
    v_next_value := 1;
  else
    v_next_value := v_row.current_value + 1;
  end if;

  if v_row.include_fy then
    v_number := v_row.prefix || to_char(v_current_fy, 'FM0000') || to_char((v_current_fy+1)%100, 'FM00') || '-' ||
                lpad(v_next_value::text, v_row.padding, '0');
  else
    v_number := v_row.prefix || lpad(v_next_value::text, v_row.padding, '0');
  end if;
  return v_number;
end;
$function$;

-- Every choice the Owner/Accounts should be offered at Invoice-creation
-- time: the normal next-sequential number (kind='sequential'), plus any
-- Cancelled invoice's number that no Posted invoice currently holds
-- (kind='reclaimed') -- covering both the simple trailing-cancellation
-- case and the harder "cancelled after a later number already exists"
-- case with the same uniform picker.
create or replace function public.fn_get_available_invoice_numbers()
returns table(invoice_no text, kind text)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Invoice bana sakte hain.';
  end if;

  return query select public.fn_peek_next_number('INV'), 'sequential'::text;

  return query
    select distinct i.invoice_no, 'reclaimed'::text
    from public.invoices i
    where i.status = 'Cancelled'
      and not exists (select 1 from public.invoices p where p.invoice_no = i.invoice_no and p.status = 'Posted')
    order by 1;
end;
$function$;

-- fn_create_invoice now accepts an explicit invoice number (from the
-- picker above) -- a reclaimed Cancelled number, or the user re-confirming
-- the plain sequential one. Omitted (old callers, offline-queued creates),
-- it falls back to the original auto-sequential behaviour unchanged.
create or replace function public.fn_create_invoice(p_sales_order_id uuid, p_invoice_date date, p_lines jsonb, p_invoice_no text default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_so record;
  v_sol record;
  v_invoice_id uuid;
  v_invoice_no text;
  v_line jsonb;
  v_qty numeric;
  v_rate numeric;
  v_tax_pct numeric;
  v_amount numeric;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_all_invoiced boolean;
  v_revenue_account text;
  v_lines jsonb := '[]'::jsonb;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Invoice bana sakte hain.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Invoice mein kam az kam ek line honi chahiye.';
  end if;

  select * into v_so from public.sales_orders where id = p_sales_order_id for update;
  if v_so.id is null then
    raise exception 'Sales Order nahi mili.';
  end if;
  if v_so.status = 'Cancelled' then
    raise exception 'Cancelled Sales Order par invoice nahi ban sakti.';
  end if;

  if p_invoice_no is not null and trim(p_invoice_no) <> '' then
    if exists (select 1 from public.invoices where invoice_no = trim(p_invoice_no) and status = 'Posted') then
      raise exception 'Invoice number % is already in use.', p_invoice_no;
    end if;
    v_invoice_no := trim(p_invoice_no);
  else
    select public.fn_get_next_number('INV') into v_invoice_no;
  end if;

  insert into public.invoices (invoice_no, sales_order_id, party_id, invoice_date, created_by)
  values (v_invoice_no, p_sales_order_id, v_so.party_id, coalesce(p_invoice_date, current_date), auth.uid())
  returning id into v_invoice_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_sol from public.sales_order_lines
      where id = (v_line->>'sales_order_line_id')::uuid and sales_order_id = p_sales_order_id
      for update;
    if v_sol.id is null then
      raise exception 'Sales Order line nahi mili.';
    end if;

    v_qty := (v_line->>'qty')::numeric;
    if v_qty <= 0 then
      raise exception 'Qty zero se zyada honi chahiye.';
    end if;
    if v_sol.invoiced_qty + v_qty > v_sol.delivered_qty then
      raise exception 'Invoice qty delivered qty se zyada nahi ho sakti (%, deliverable: %).', v_sol.description, v_sol.delivered_qty - v_sol.invoiced_qty;
    end if;

    v_rate := coalesce((v_line->>'rate')::numeric, v_sol.rate);
    v_tax_pct := coalesce((v_line->>'tax_pct')::numeric, v_sol.tax_pct);
    v_amount := round(v_qty * v_rate, 2);

    insert into public.invoice_lines
      (invoice_id, sales_order_line_id, item_id, description, qty, unit, rate, tax_pct, hs_code, sort_order)
    values
      (v_invoice_id, v_sol.id, v_sol.item_id, v_sol.description, v_qty, v_sol.unit, v_rate, v_tax_pct, nullif(trim(v_line->>'hs_code'), ''), 0);

    update public.sales_order_lines set invoiced_qty = invoiced_qty + v_qty where id = v_sol.id;

    v_subtotal := v_subtotal + v_amount;
    v_tax_total := v_tax_total + round(v_amount * v_tax_pct / 100, 2);
  end loop;

  update public.invoices
    set subtotal = round(v_subtotal, 2), tax_total = round(v_tax_total, 2), grand_total = round(v_subtotal + v_tax_total, 2)
    where id = v_invoice_id;

  v_revenue_account := case when v_so.business_line = 'fabrication' then '4010' else '4000' end;

  v_lines := v_lines || jsonb_build_object('account_code', '1200', 'party_id', v_so.party_id, 'debit', round(v_subtotal + v_tax_total, 2), 'credit', 0, 'memo', 'Trade Receivables');
  v_lines := v_lines || jsonb_build_object('account_code', v_revenue_account, 'party_id', null, 'debit', 0, 'credit', round(v_subtotal, 2), 'memo', 'Sales Revenue');
  if v_tax_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '2400', 'party_id', null, 'debit', 0, 'credit', round(v_tax_total, 2), 'memo', 'Output Sales Tax (GST)');
  end if;

  perform public._fn_post_journal_entry_core(
    coalesce(p_invoice_date, current_date), 'Invoice ' || v_invoice_no, 'invoices', v_invoice_id, v_lines
  );

  select bool_and(invoiced_qty >= ordered_qty) into v_all_invoiced
    from public.sales_order_lines where sales_order_id = p_sales_order_id;

  update public.sales_orders
    set status = case when v_all_invoiced then 'Invoiced' else status end
    where id = p_sales_order_id;

  return v_invoice_id;
end;
$function$;

-- Customer/Supplier Ledger: a Cancelled invoice's original posting AND its
-- cancellation reversal net to exactly zero and are pure clutter in a
-- party's statement -- both share journal_entries.source_table='invoices'
-- and source_id = that invoice's id (see fn_cancel_invoice), so both are
-- excluded together. The running balance is recomputed fresh over
-- whatever remains, so totals are unaffected either way.
create or replace function public.fn_party_ledger(p_party_id uuid, p_limit integer, p_offset integer)
 returns table(entry_date date, narration text, debit numeric, credit numeric, memo text, running numeric, total_rows bigint, total_debit numeric, total_credit numeric)
 language sql
 stable
 set search_path to 'public'
as $function$
  with ledger as (
    select je.entry_date,
           je.narration,
           jl.id as line_id,
           jl.debit,
           jl.credit,
           jl.memo,
           sum(jl.debit - jl.credit) over (order by je.entry_date, jl.id
                                           rows between unbounded preceding and current row) as running
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where jl.party_id = p_party_id
      and not (
        je.source_table = 'invoices'
        and je.source_id in (select id from public.invoices where status = 'Cancelled')
      )
  ),
  totals as (
    select count(*)::bigint as total_rows,
           coalesce(sum(debit), 0) as total_debit,
           coalesce(sum(credit), 0) as total_credit
    from ledger
  )
  select l.entry_date, l.narration, l.debit, l.credit, l.memo, l.running,
         t.total_rows, t.total_debit, t.total_credit
  from ledger l, totals t
  order by l.entry_date, l.line_id
  offset p_offset
  limit p_limit;
$function$;
