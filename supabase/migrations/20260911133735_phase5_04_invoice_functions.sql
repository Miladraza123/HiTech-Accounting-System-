-- GST Invoice. Pakistan: a single FBR Sales Tax (GST) rate per line, no
-- CGST/SGST/IGST split. Invoicing is against DELIVERED qty (not ordered)
-- — "bill what's been delivered" — so qty can never push
-- invoiced_qty past delivered_qty on a line.
create or replace function public.fn_create_invoice(
  p_sales_order_id uuid,
  p_invoice_date date,
  p_lines jsonb -- [{sales_order_line_id, qty, rate, tax_pct}]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

  select public.fn_get_next_number('INV') into v_invoice_no;

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
      (invoice_id, sales_order_line_id, item_id, description, qty, unit, rate, tax_pct, sort_order)
    values
      (v_invoice_id, v_sol.id, v_sol.item_id, v_sol.description, v_qty, v_sol.unit, v_rate, v_tax_pct, 0);

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
$$;

-- Cancel an Invoice. Blocked once any payment has been allocated against
-- it — must reverse the payment allocation first (or cancel the payment).
create or replace function public.fn_cancel_invoice(p_invoice_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv record;
  v_so record;
  v_line record;
  v_revenue_account text;
  v_lines jsonb := '[]'::jsonb;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Invoice cancel kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancel karne ki wajah likhna zaroori hai.';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if v_inv.id is null then
    raise exception 'Invoice nahi mili.';
  end if;
  if v_inv.status = 'Cancelled' then
    raise exception 'Yeh Invoice pehle se cancel hai.';
  end if;
  if exists (
    select 1 from public.payment_allocations pa join public.payments p on p.id = pa.payment_id
    where pa.invoice_id = p_invoice_id and p.status = 'Posted'
  ) then
    raise exception 'Is Invoice par payment allocate ho chuki hai — pehle payment cancel karen.';
  end if;

  select * into v_so from public.sales_orders where id = v_inv.sales_order_id for update;

  for v_line in select * from public.invoice_lines where invoice_id = p_invoice_id loop
    update public.sales_order_lines set invoiced_qty = invoiced_qty - v_line.qty where id = v_line.sales_order_line_id;
  end loop;

  v_revenue_account := case when v_so.business_line = 'fabrication' then '4010' else '4000' end;

  v_lines := v_lines || jsonb_build_object('account_code', v_revenue_account, 'party_id', null, 'debit', v_inv.subtotal, 'credit', 0, 'memo', 'Sales Revenue — reversed');
  if v_inv.tax_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '2400', 'party_id', null, 'debit', v_inv.tax_total, 'credit', 0, 'memo', 'Output Sales Tax (GST) — reversed');
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', '1200', 'party_id', v_so.party_id, 'debit', 0, 'credit', v_inv.grand_total, 'memo', 'Trade Receivables — reversed');

  perform public._fn_post_journal_entry_core(current_date, 'Invoice ' || v_inv.invoice_no || ' — cancelled', 'invoices', p_invoice_id, v_lines);

  update public.sales_orders
    set status = case when status = 'Invoiced' then 'Delivered' else status end
    where id = v_inv.sales_order_id and status not in ('Cancelled','Closed');

  update public.invoices set status = 'Cancelled', cancel_reason = p_reason where id = p_invoice_id;
end;
$$;

revoke execute on function public.fn_create_invoice(uuid, date, jsonb) from public, anon;
revoke execute on function public.fn_cancel_invoice(uuid, text) from public, anon;

grant execute on function public.fn_create_invoice(uuid, date, jsonb) to authenticated;
grant execute on function public.fn_cancel_invoice(uuid, text) to authenticated;
