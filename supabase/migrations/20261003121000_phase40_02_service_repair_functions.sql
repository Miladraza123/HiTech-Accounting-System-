-- Phase 40.02 — Service/Repair module RPCs.

create or replace function public.fn_create_service_job(
  p_party_id uuid,
  p_asset_description text,
  p_customer_dc_no text,
  p_customer_dc_date date,
  p_received_condition_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_job_no text;
begin
  if not (public.is_owner() or public.has_role('sales') or public.has_role('store')) then
    raise exception 'Sirf Owner, Sales ya Store Service Job bana sakte hain.';
  end if;
  if coalesce(trim(p_asset_description), '') = '' then
    raise exception 'Machine/Part ka description likhna zaroori hai.';
  end if;

  select public.fn_get_next_number('SVJ') into v_job_no;

  insert into public.service_jobs
    (job_no, party_id, asset_description, customer_dc_no, customer_dc_date, received_condition_notes, created_by)
  values
    (v_job_no, p_party_id, trim(p_asset_description), nullif(trim(p_customer_dc_no), ''), p_customer_dc_date, nullif(trim(p_received_condition_notes), ''), auth.uid())
  returning id into v_job_id;

  return v_job_id;
end;
$$;

revoke execute on function public.fn_create_service_job(uuid, text, text, date, text) from public, anon;
grant execute on function public.fn_create_service_job(uuid, text, text, date, text) to authenticated;

create or replace function public.fn_complete_service_job(p_service_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
begin
  if not (public.is_owner() or public.has_role('sales') or public.has_role('store')) then
    raise exception 'Sirf Owner, Sales ya Store Service Job complete kar sakte hain.';
  end if;

  select * into v_job from public.service_jobs where id = p_service_job_id for update;
  if v_job.id is null then
    raise exception 'Service Job nahi mili.';
  end if;
  if v_job.status <> 'Received' then
    raise exception 'Yeh Service Job "Received" status mein nahi hai (abhi: %).', v_job.status;
  end if;

  update public.service_jobs set status = 'Completed' where id = p_service_job_id;
end;
$$;

revoke execute on function public.fn_complete_service_job(uuid) from public, anon;
grant execute on function public.fn_complete_service_job(uuid) to authenticated;

create or replace function public.fn_cancel_service_job(p_service_job_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
begin
  if not (public.is_owner() or public.has_role('sales') or public.has_role('store')) then
    raise exception 'Sirf Owner, Sales ya Store Service Job cancel kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancel karne ki wajah likhna zaroori hai.';
  end if;

  select * into v_job from public.service_jobs where id = p_service_job_id for update;
  if v_job.id is null then
    raise exception 'Service Job nahi mili.';
  end if;
  if v_job.status = 'Cancelled' then
    raise exception 'Yeh Service Job pehle se cancel hai.';
  end if;
  if exists (select 1 from public.service_deliveries where service_job_id = p_service_job_id and status <> 'Cancelled')
     or exists (select 1 from public.service_invoices where service_job_id = p_service_job_id and status <> 'Cancelled') then
    raise exception 'Delivery ya Invoice ban chuki hai — pehle unhe cancel karen.';
  end if;

  update public.service_jobs set status = 'Cancelled', cancel_reason = p_reason where id = p_service_job_id;
end;
$$;

revoke execute on function public.fn_cancel_service_job(uuid, text) from public, anon;
grant execute on function public.fn_cancel_service_job(uuid, text) to authenticated;

create or replace function public.fn_create_service_delivery(
  p_service_job_id uuid,
  p_delivery_date date,
  p_vehicle_no text,
  p_driver_name text,
  p_remarks text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_delivery_id uuid;
  v_delivery_no text;
begin
  if not (public.is_owner() or public.has_role('dispatch')) then
    raise exception 'Sirf Owner ya Dispatch Service Delivery bana sakte hain.';
  end if;

  select * into v_job from public.service_jobs where id = p_service_job_id for update;
  if v_job.id is null then
    raise exception 'Service Job nahi mili.';
  end if;
  if v_job.status <> 'Completed' then
    raise exception 'Delivery sirf "Completed" Service Job ke liye ban sakti hai (abhi: %).', v_job.status;
  end if;

  select public.fn_get_next_number('SVD') into v_delivery_no;

  insert into public.service_deliveries
    (delivery_no, service_job_id, party_id, delivery_date, vehicle_no, driver_name, remarks, created_by)
  values
    (v_delivery_no, p_service_job_id, v_job.party_id, coalesce(p_delivery_date, current_date), nullif(trim(p_vehicle_no), ''), nullif(trim(p_driver_name), ''), nullif(trim(p_remarks), ''), auth.uid())
  returning id into v_delivery_id;

  update public.service_jobs set status = 'Delivered' where id = p_service_job_id;

  return v_delivery_id;
end;
$$;

revoke execute on function public.fn_create_service_delivery(uuid, date, text, text, text) from public, anon;
grant execute on function public.fn_create_service_delivery(uuid, date, text, text, text) to authenticated;

create or replace function public.fn_cancel_service_delivery(p_service_delivery_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery record;
begin
  if not (public.is_owner() or public.has_role('dispatch')) then
    raise exception 'Sirf Owner ya Dispatch Service Delivery cancel kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancel karne ki wajah likhna zaroori hai.';
  end if;

  select * into v_delivery from public.service_deliveries where id = p_service_delivery_id for update;
  if v_delivery.id is null then
    raise exception 'Service Delivery nahi mili.';
  end if;
  if v_delivery.status = 'Cancelled' then
    raise exception 'Yeh Service Delivery pehle se cancel hai.';
  end if;

  update public.service_deliveries set status = 'Cancelled', cancel_reason = p_reason where id = p_service_delivery_id;
  -- The job goes back to "Completed" (ready to deliver again) only if it
  -- was this delivery that most recently moved it to "Delivered" — a
  -- second still-Issued delivery on the same job keeps it Delivered.
  update public.service_jobs
    set status = 'Completed'
    where id = v_delivery.service_job_id
      and status = 'Delivered'
      and not exists (
        select 1 from public.service_deliveries
        where service_job_id = v_delivery.service_job_id and status = 'Issued' and id <> p_service_delivery_id
      );
end;
$$;

revoke execute on function public.fn_cancel_service_delivery(uuid, text) from public, anon;
grant execute on function public.fn_cancel_service_delivery(uuid, text) to authenticated;

-- p_lines: [{description, qty, rate, tax_pct}] — free-form (labor charges,
-- spare parts cost, ...), nothing to reconcile against a Sales Order line
-- since there is no Sales Order behind a Service Job.
create or replace function public.fn_create_service_invoice(
  p_service_job_id uuid,
  p_invoice_date date,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

  select public.fn_get_next_number('SVI') into v_invoice_no;

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
$$;

revoke execute on function public.fn_create_service_invoice(uuid, date, jsonb) from public, anon;
grant execute on function public.fn_create_service_invoice(uuid, date, jsonb) to authenticated;

create or replace function public.fn_cancel_service_invoice(p_service_invoice_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv record;
  v_lines jsonb := '[]'::jsonb;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Service Invoice cancel kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancel karne ki wajah likhna zaroori hai.';
  end if;

  select * into v_inv from public.service_invoices where id = p_service_invoice_id for update;
  if v_inv.id is null then
    raise exception 'Service Invoice nahi mili.';
  end if;
  if v_inv.status = 'Cancelled' then
    raise exception 'Yeh Service Invoice pehle se cancel hai.';
  end if;

  v_lines := v_lines || jsonb_build_object('account_code', '4020', 'party_id', null, 'debit', v_inv.subtotal, 'credit', 0, 'memo', 'Service Revenue — reversed');
  if v_inv.tax_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '2400', 'party_id', null, 'debit', v_inv.tax_total, 'credit', 0, 'memo', 'Output Sales Tax (GST) — reversed');
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', '1200', 'party_id', v_inv.party_id, 'debit', 0, 'credit', v_inv.grand_total, 'memo', 'Trade Receivables — Service — reversed');

  perform public._fn_post_journal_entry_core(current_date, 'Service Invoice ' || v_inv.invoice_no || ' — cancelled', 'service_invoices', p_service_invoice_id, v_lines);

  update public.service_invoices set status = 'Cancelled', cancel_reason = p_reason where id = p_service_invoice_id;
end;
$$;

revoke execute on function public.fn_cancel_service_invoice(uuid, text) from public, anon;
grant execute on function public.fn_cancel_service_invoice(uuid, text) to authenticated;
