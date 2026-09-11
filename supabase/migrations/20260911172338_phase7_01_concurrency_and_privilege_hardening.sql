-- ============================================================
-- Phase 7 hardening fix #1: fn_get_next_number was callable directly
-- by ANY authenticated user (even one with no role assigned yet), who
-- could burn through a fiscal-year document sequence (INV/SO/JOB/...)
-- without ever creating the actual document, leaving confusing gaps in
-- what's meant to be an audit-relevant numbering series. It only ever
-- needs to be called from inside other SECURITY DEFINER functions
-- (which still work fine after this — a function running as its
-- owner does not need its own EXECUTE grant re-checked to call
-- another function), so lock it down the same way every internal
-- `_fn_*` helper already is.
--
-- NOTE: superseded by phase7_02 — this revoke turned out to break a
-- real, working direct call site (createQueryAction in
-- src/app/actions/queries.ts). Kept here for migration history
-- accuracy; see phase7_02 for the revert and full explanation.
-- ============================================================
revoke execute on function public.fn_get_next_number(text) from public, anon, authenticated;

-- ============================================================
-- Phase 7 hardening fix #2: check-then-act races against a live
-- aggregate (view), not a single row that a plain UPDATE/SELECT...FOR
-- UPDATE could lock — same class of problem _fn_post_stock_ledger
-- already solved with pg_advisory_xact_lock for postings. Two
-- concurrent callers reading the same free_qty (via stock_availability)
-- or the same outstanding_amount (via invoice_outstanding /
-- supplier_bill_outstanding) before either commits could each pass
-- their own check and together over-reserve stock or over-allocate a
-- payment beyond what's actually free/owed. Fixed by taking the same
-- advisory lock scheme already used for stock postings (item+warehouse
-- key) and a matching one for invoice/bill allocation (doc id key),
-- serializing concurrent attempts on the same target so the second
-- one's read reflects the first one's committed effect.
-- ============================================================

create or replace function public.fn_reserve_job_material(
  p_job_id uuid,
  p_item_id uuid,
  p_warehouse_id uuid,
  p_qty numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_free_qty numeric;
  v_id uuid;
begin
  if not (public.is_owner() or public.has_role('production') or public.has_role('store')) then
    raise exception 'Aapko reserve karne ki ijazat nahi.';
  end if;
  if p_qty <= 0 then
    raise exception 'Qty zero se zyada honi chahiye.';
  end if;
  if not exists (select 1 from public.job_material_requirements where job_id = p_job_id and item_id = p_item_id) then
    raise exception 'Yeh item is Job ki requirement mein nahi hai.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_item_id::text || ':' || p_warehouse_id::text, 0));

  select free_qty into v_free_qty from public.stock_availability where item_id = p_item_id and warehouse_id = p_warehouse_id;
  if coalesce(v_free_qty, 0) < p_qty then
    raise exception 'Free stock kam hai (available %, mangi %).', coalesce(v_free_qty, 0), p_qty;
  end if;

  insert into public.stock_reservations (job_id, item_id, warehouse_id, reserved_qty, reservation_mode, created_by)
  values (p_job_id, p_item_id, p_warehouse_id, p_qty, 'manual', auth.uid())
  returning id into v_id;

  update public.job_material_requirements
    set reserved_qty = reserved_qty + p_qty
    where job_id = p_job_id and item_id = p_item_id;

  perform public._fn_recalc_job_material_status(p_job_id);
  return v_id;
end;
$$;

create or replace function public.fn_create_job(
  p_sales_order_line_id uuid,
  p_warehouse_id uuid,
  p_product_template_id uuid,
  p_description text,
  p_job_qty numeric,
  p_responsible_user_id uuid,
  p_start_date date,
  p_required_delivery_date date,
  p_material_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so_id uuid;
  v_business_line text;
  v_job_id uuid;
  v_job_no text;
  v_line jsonb;
  v_free_qty numeric;
  v_to_reserve numeric;
begin
  if not (public.is_owner() or public.has_role('production')) then
    raise exception 'Sirf Owner ya Production Job bana sakte hain.';
  end if;
  if p_job_qty <= 0 then
    raise exception 'Job qty zero se zyada honi chahiye.';
  end if;

  select sol.sales_order_id, so.business_line into v_so_id, v_business_line
    from public.sales_order_lines sol
    join public.sales_orders so on so.id = sol.sales_order_id
    where sol.id = p_sales_order_line_id;

  if v_so_id is null then
    raise exception 'Sales Order line nahi mili.';
  end if;
  if v_business_line <> 'fabrication' then
    raise exception 'Job sirf Fabrication business line ki Sales Order ke liye ban sakti hai.';
  end if;

  select public.fn_get_next_number('JOB') into v_job_no;

  insert into public.jobs
    (job_no, sales_order_id, sales_order_line_id, product_template_id, warehouse_id,
     description, job_qty, responsible_user_id, start_date, required_delivery_date, created_by)
  values
    (v_job_no, v_so_id, p_sales_order_line_id, p_product_template_id, p_warehouse_id,
     p_description, p_job_qty, p_responsible_user_id, p_start_date, p_required_delivery_date, auth.uid())
  returning id into v_job_id;

  if p_product_template_id is not null then
    insert into public.job_material_requirements (job_id, item_id, required_qty, unit, source)
    select v_job_id, ptl.item_id, round(ptl.qty_per_unit * p_job_qty, 3), ptl.unit, 'template'
    from public.product_template_lines ptl
    where ptl.template_id = p_product_template_id;
  else
    if jsonb_array_length(p_material_lines) = 0 then
      raise exception 'Material requirement batayen (ya koi template select karen).';
    end if;
    for v_line in select * from jsonb_array_elements(p_material_lines) loop
      insert into public.job_material_requirements (job_id, item_id, required_qty, unit, source)
      values (v_job_id, (v_line->>'item_id')::uuid, (v_line->>'required_qty')::numeric, nullif(v_line->>'unit',''), 'manual');
    end loop;
  end if;

  -- Auto-reserve whatever free stock is available for each requirement
  for v_line in
    select jsonb_build_object('item_id', item_id, 'required_qty', required_qty) from public.job_material_requirements where job_id = v_job_id
  loop
    perform pg_advisory_xact_lock(hashtextextended((v_line->>'item_id') || ':' || p_warehouse_id::text, 0));

    select free_qty into v_free_qty from public.stock_availability
      where item_id = (v_line->>'item_id')::uuid and warehouse_id = p_warehouse_id;
    v_free_qty := coalesce(v_free_qty, 0);
    v_to_reserve := least(v_free_qty, (v_line->>'required_qty')::numeric);
    if v_to_reserve > 0 then
      insert into public.stock_reservations (job_id, item_id, warehouse_id, reserved_qty, reservation_mode, created_by)
      values (v_job_id, (v_line->>'item_id')::uuid, p_warehouse_id, v_to_reserve, 'auto', auth.uid());
      update public.job_material_requirements
        set reserved_qty = reserved_qty + v_to_reserve
        where job_id = v_job_id and item_id = (v_line->>'item_id')::uuid;
    end if;
  end loop;

  perform public._fn_recalc_job_material_status(v_job_id);

  return v_job_id;
end;
$$;

create or replace function public.fn_create_payment(
  p_party_id uuid,
  p_direction text,
  p_payment_date date,
  p_method text,
  p_reference_no text,
  p_amount numeric,
  p_notes text,
  p_allocations jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party record;
  v_payment_id uuid;
  v_payment_no text;
  v_line jsonb;
  v_alloc_total numeric := 0;
  v_outstanding numeric;
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

  select public.fn_get_next_number('PAY') into v_payment_no;

  insert into public.payments
    (payment_no, party_id, direction, payment_date, method, reference_no, amount, unallocated_amount, notes, created_by)
  values
    (v_payment_no, p_party_id, p_direction, coalesce(p_payment_date, current_date), p_method, p_reference_no, p_amount, p_amount - v_alloc_total, p_notes, auth.uid())
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
        jsonb_build_object('account_code', '1100', 'party_id', null, 'debit', p_amount, 'credit', 0, 'memo', 'Bank/Cash'),
        jsonb_build_object('account_code', '1200', 'party_id', p_party_id, 'debit', 0, 'credit', p_amount, 'memo', 'Trade Receivables')
      )
    );
  else
    perform public._fn_post_journal_entry_core(
      coalesce(p_payment_date, current_date), 'Payment ' || v_payment_no, 'payments', v_payment_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '2100', 'party_id', p_party_id, 'debit', p_amount, 'credit', 0, 'memo', 'Trade Payables'),
        jsonb_build_object('account_code', '1100', 'party_id', null, 'debit', 0, 'credit', p_amount, 'memo', 'Bank/Cash')
      )
    );
  end if;

  return v_payment_id;
end;
$$;

create or replace function public.fn_allocate_payment(p_payment_id uuid, p_allocations jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_line jsonb;
  v_alloc_total numeric := 0;
  v_outstanding numeric;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts allocate kar sakte hain.';
  end if;
  if jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) = 0 then
    raise exception 'Kam az kam ek allocation honi chahiye.';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment.id is null then
    raise exception 'Payment nahi mili.';
  end if;
  if v_payment.status <> 'Posted' then
    raise exception 'Yeh Payment Posted nahi hai.';
  end if;

  for v_line in select * from jsonb_array_elements(p_allocations) loop
    v_alloc_total := v_alloc_total + (v_line->>'amount')::numeric;
  end loop;
  if v_alloc_total > v_payment.unallocated_amount then
    raise exception 'Allocation unallocated amount se zyada hai (unallocated: %).', v_payment.unallocated_amount;
  end if;

  for v_line in select * from jsonb_array_elements(p_allocations) loop
    if v_payment.direction = 'receipt' then
      perform pg_advisory_xact_lock(hashtextextended('invoice:' || (v_line->>'invoice_id'), 0));

      select outstanding_amount into v_outstanding from public.invoice_outstanding
        where invoice_id = (v_line->>'invoice_id')::uuid and party_id = v_payment.party_id;
      if v_outstanding is null then
        raise exception 'Invoice is party ki nahi hai ya mili nahi.';
      end if;
      if (v_line->>'amount')::numeric > v_outstanding then
        raise exception 'Allocation outstanding se zyada hai (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, invoice_id, amount)
      values (p_payment_id, (v_line->>'invoice_id')::uuid, (v_line->>'amount')::numeric);
    else
      perform pg_advisory_xact_lock(hashtextextended('supplier_bill:' || (v_line->>'supplier_bill_id'), 0));

      select outstanding_amount into v_outstanding from public.supplier_bill_outstanding
        where supplier_bill_id = (v_line->>'supplier_bill_id')::uuid and supplier_id = v_payment.party_id;
      if v_outstanding is null then
        raise exception 'Supplier Bill is party ki nahi hai ya mili nahi.';
      end if;
      if (v_line->>'amount')::numeric > v_outstanding then
        raise exception 'Allocation outstanding se zyada hai (outstanding: %).', v_outstanding;
      end if;
      insert into public.payment_allocations (payment_id, supplier_bill_id, amount)
      values (p_payment_id, (v_line->>'supplier_bill_id')::uuid, (v_line->>'amount')::numeric);
    end if;
  end loop;

  update public.payments set unallocated_amount = unallocated_amount - v_alloc_total where id = p_payment_id;
end;
$$;
