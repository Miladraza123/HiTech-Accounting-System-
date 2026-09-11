-- Book a Supplier Bill against a 'stock'-type GRN — clears GRN Clearing
-- (1330) into Trade Payables (2100), and recognises reclaimable Input
-- Sales Tax (1400) for the first time (GRN receiving never posted tax,
-- since it happens before the supplier's actual tax invoice exists).
-- Always books ALL lines of the GRN at once, at exactly the GRN's own
-- rate/tax_pct (no override) — this keeps 1330 always balanced 1:1
-- against what was posted at GRN time, with zero price-variance risk.
-- 'direct'/'general' GRNs already booked Trade Payables straight at
-- receiving time (see fn_create_grn) — no bill needed, and this
-- function refuses to double-book them.
create or replace function public.fn_create_supplier_bill(
  p_grn_id uuid,
  p_bill_date date,
  p_supplier_bill_ref text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grn record;
  v_po record;
  v_gl record;
  v_bill_id uuid;
  v_bill_no text;
  v_amount numeric;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  v_line_count int := 0;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Supplier Bill bana sakte hain.';
  end if;

  select * into v_grn from public.grns where id = p_grn_id for update;
  if v_grn.id is null then
    raise exception 'GRN nahi mili.';
  end if;

  select * into v_po from public.purchase_orders where id = v_grn.purchase_order_id;
  if v_po.purchase_type <> 'stock' then
    raise exception 'Is GRN ki Trade Payables receiving ke waqt hi book ho chuki thi — alag Supplier Bill zaroori nahi.';
  end if;

  if exists (select 1 from public.supplier_bills where grn_id = p_grn_id and status <> 'Cancelled') then
    raise exception 'Is GRN ka Supplier Bill pehle se ban chuka hai.';
  end if;

  select public.fn_get_next_number('BILL') into v_bill_no;

  insert into public.supplier_bills
    (bill_no, supplier_id, purchase_order_id, grn_id, bill_date, supplier_bill_ref, created_by)
  values
    (v_bill_no, v_grn.supplier_id, v_grn.purchase_order_id, p_grn_id, coalesce(p_bill_date, current_date), p_supplier_bill_ref, auth.uid())
  returning id into v_bill_id;

  for v_gl in select * from public.grn_lines where grn_id = p_grn_id loop
    v_line_count := v_line_count + 1;
    v_amount := round(v_gl.this_receipt_qty * v_gl.rate, 2);

    insert into public.supplier_bill_lines
      (supplier_bill_id, grn_line_id, item_id, description, qty, rate, tax_pct, sort_order)
    values
      (v_bill_id, v_gl.id, v_gl.item_id, coalesce((select description from public.items where id = v_gl.item_id), 'Item'), v_gl.this_receipt_qty, v_gl.rate, v_gl.tax_pct, v_line_count);

    v_subtotal := v_subtotal + v_amount;
    v_tax_total := v_tax_total + round(v_amount * v_gl.tax_pct / 100, 2);
  end loop;

  if v_line_count = 0 then
    raise exception 'Is GRN ki koi line nahi mili.';
  end if;

  update public.supplier_bills
    set subtotal = round(v_subtotal, 2), tax_total = round(v_tax_total, 2), grand_total = round(v_subtotal + v_tax_total, 2)
    where id = v_bill_id;

  v_lines := v_lines || jsonb_build_object('account_code', '1330', 'party_id', v_grn.supplier_id, 'debit', round(v_subtotal, 2), 'credit', 0, 'memo', 'GRN Clearing');
  if v_tax_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1400', 'party_id', null, 'debit', round(v_tax_total, 2), 'credit', 0, 'memo', 'Input Sales Tax');
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', '2100', 'party_id', v_grn.supplier_id, 'debit', 0, 'credit', round(v_subtotal + v_tax_total, 2), 'memo', 'Trade Payables');

  perform public._fn_post_journal_entry_core(coalesce(p_bill_date, current_date), 'Supplier Bill ' || v_bill_no, 'supplier_bills', v_bill_id, v_lines);

  return v_bill_id;
end;
$$;

create or replace function public.fn_cancel_supplier_bill(p_supplier_bill_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill record;
  v_lines jsonb := '[]'::jsonb;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Supplier Bill cancel kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancel karne ki wajah likhna zaroori hai.';
  end if;

  select * into v_bill from public.supplier_bills where id = p_supplier_bill_id for update;
  if v_bill.id is null then
    raise exception 'Supplier Bill nahi mili.';
  end if;
  if v_bill.status = 'Cancelled' then
    raise exception 'Yeh Bill pehle se cancel hai.';
  end if;
  if exists (
    select 1 from public.payment_allocations pa join public.payments p on p.id = pa.payment_id
    where pa.supplier_bill_id = p_supplier_bill_id and p.status = 'Posted'
  ) then
    raise exception 'Is Bill par payment allocate ho chuki hai — pehle payment cancel karen.';
  end if;

  v_lines := v_lines || jsonb_build_object('account_code', '2100', 'party_id', v_bill.supplier_id, 'debit', v_bill.grand_total, 'credit', 0, 'memo', 'Trade Payables — reversed');
  v_lines := v_lines || jsonb_build_object('account_code', '1330', 'party_id', v_bill.supplier_id, 'debit', 0, 'credit', v_bill.subtotal, 'memo', 'GRN Clearing — reversed');
  if v_bill.tax_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1400', 'party_id', null, 'debit', 0, 'credit', v_bill.tax_total, 'memo', 'Input Sales Tax — reversed');
  end if;

  perform public._fn_post_journal_entry_core(current_date, 'Supplier Bill ' || v_bill.bill_no || ' — cancelled', 'supplier_bills', p_supplier_bill_id, v_lines);

  update public.supplier_bills set status = 'Cancelled', cancel_reason = p_reason where id = p_supplier_bill_id;
end;
$$;

revoke execute on function public.fn_create_supplier_bill(uuid, date, text) from public, anon;
revoke execute on function public.fn_cancel_supplier_bill(uuid, text) from public, anon;

grant execute on function public.fn_create_supplier_bill(uuid, date, text) to authenticated;
grant execute on function public.fn_cancel_supplier_bill(uuid, text) to authenticated;
