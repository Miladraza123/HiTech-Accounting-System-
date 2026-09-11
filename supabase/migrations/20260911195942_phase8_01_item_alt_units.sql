-- Item-specific alternate units usable ONLY at Sale/Issue/Delivery entry points
-- (Sales Order lines, Delivery Challan, Invoice display, Job material requirement).
-- Purchase Orders / GRN always stay in items.base_unit, unchanged.
-- Deliberately separate from the existing global `unit_conversions` table (which is
-- item-agnostic, e.g. TON->KG for any item) since real-world factors here are
-- item-specific (e.g. "1 PCS of THIS bar = 12 KG", not true for every item).
-- Convention: 1 unit of item_alt_units.unit = item_alt_units.factor * items.base_unit.
create table public.item_alt_units (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  unit text not null references public.units(code),
  factor numeric(18,6) not null check (factor > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (item_id, unit)
);

comment on table public.item_alt_units is 'Item-specific alternate units for Sale/Issue/Delivery entry (Sales Order, Delivery Challan, Invoice, Job material). factor: 1 unit of item_alt_units.unit = factor * items.base_unit. Purchase/GRN is unaffected — always base_unit.';

create index idx_item_alt_units_item on public.item_alt_units(item_id);

alter table public.item_alt_units enable row level security;

create policy p_select on public.item_alt_units for select using (true);
create policy p_insert on public.item_alt_units for insert
  with check (public.is_owner() or public.has_role('store') or public.has_role('production'));
create policy p_update on public.item_alt_units for update
  using (public.is_owner() or public.has_role('store') or public.has_role('production'))
  with check (public.is_owner() or public.has_role('store') or public.has_role('production'));
create policy p_delete on public.item_alt_units for delete using (public.is_owner());

-- Guard: an alt unit must differ from the item's own base_unit (avoids ambiguous double-entry).
create or replace function public._fn_check_item_alt_unit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_unit text;
begin
  select base_unit into v_base_unit from public.items where id = new.item_id;
  if v_base_unit is null then
    raise exception 'Item nahi mila.';
  end if;
  if new.unit = v_base_unit then
    raise exception 'Alternate unit item ke base unit (%) se mukhtalif honi chahiye.', v_base_unit;
  end if;
  return new;
end;
$$;

revoke all on function public._fn_check_item_alt_unit() from anon, public;

create trigger trg_item_alt_units_check
before insert or update on public.item_alt_units
for each row execute function public._fn_check_item_alt_unit();

-- Delivery Challan lines: base-unit-equivalent qty used for stock ledger posting
-- when issue_from_stock=true and the line's unit differs from the item's base_unit.
-- Falls back to delivered_qty when null (order unit already = base unit, or legacy rows).
alter table public.delivery_challan_lines add column stock_qty numeric(18,3);
comment on column public.delivery_challan_lines.stock_qty is 'Base-unit-equivalent quantity for stock ledger posting (multi-unit conversion). Coalesced to delivered_qty when null.';

create or replace function public.fn_create_delivery_challan(p_sales_order_id uuid, p_warehouse_id uuid, p_delivery_date date, p_vehicle_no text, p_driver_name text, p_remarks text, p_lines jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_so record;
  v_sol record;
  v_dc_id uuid;
  v_dc_no text;
  v_line jsonb;
  v_qty numeric;
  v_stock_qty numeric;
  v_issue boolean;
  v_avg_cost numeric;
  v_value numeric;
  v_stock_value_total numeric := 0;
  v_cogs_account text;
  v_all_delivered boolean;
  v_any_delivered boolean;
  v_job record;
begin
  if not (public.is_owner() or public.has_role('dispatch')) then
    raise exception 'Sirf Owner ya Dispatch Delivery Challan bana sakte hain.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'DC mein kam az kam ek line honi chahiye.';
  end if;

  select * into v_so from public.sales_orders where id = p_sales_order_id for update;
  if v_so.id is null then
    raise exception 'Sales Order nahi mili.';
  end if;
  if v_so.status in ('Cancelled','Closed') then
    raise exception 'Is Sales Order par delivery nahi ho sakti (% hai).', v_so.status;
  end if;

  select public.fn_get_next_number('DC') into v_dc_no;

  insert into public.delivery_challans
    (dc_no, sales_order_id, party_id, warehouse_id, delivery_date, vehicle_no, driver_name, remarks, created_by)
  values
    (v_dc_no, p_sales_order_id, v_so.party_id, p_warehouse_id, coalesce(p_delivery_date, current_date), p_vehicle_no, p_driver_name, p_remarks, auth.uid())
  returning id into v_dc_id;

  v_cogs_account := case when v_so.business_line = 'fabrication' then '5010' else '5000' end;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_sol from public.sales_order_lines
      where id = (v_line->>'sales_order_line_id')::uuid and sales_order_id = p_sales_order_id
      for update;
    if v_sol.id is null then
      raise exception 'Sales Order line nahi mili.';
    end if;

    v_qty := (v_line->>'delivered_qty')::numeric;
    if v_qty <= 0 then
      raise exception 'Delivered qty zero se zyada honi chahiye.';
    end if;
    if v_sol.delivered_qty + v_qty > v_sol.ordered_qty then
      raise exception 'Delivered qty ordered qty se zyada nahi ho sakti (%, pending: %).', v_sol.description, v_sol.ordered_qty - v_sol.delivered_qty;
    end if;

    v_issue := coalesce((v_line->>'issue_from_stock')::boolean, false);
    v_stock_qty := coalesce((v_line->>'stock_qty')::numeric, v_qty);
    if v_issue and v_stock_qty <= 0 then
      raise exception 'Stock qty zero se zyada honi chahiye.';
    end if;

    insert into public.delivery_challan_lines
      (dc_id, sales_order_line_id, item_id, description, delivered_qty, unit, issue_from_stock, stock_qty, sort_order)
    values
      (v_dc_id, v_sol.id, v_sol.item_id, v_sol.description, v_qty, v_sol.unit, v_issue, v_stock_qty, 0);

    update public.sales_order_lines set delivered_qty = delivered_qty + v_qty where id = v_sol.id;

    if v_issue then
      if v_sol.item_id is null then
        raise exception 'Stock se issue karne ke liye item zaroori hai.';
      end if;
      select avg_cost into v_avg_cost from public.stock_ledger
        where item_id = v_sol.item_id and warehouse_id = p_warehouse_id
        order by created_at desc, id desc limit 1;
      v_avg_cost := coalesce(v_avg_cost, 0);
      perform public._fn_post_stock_ledger(v_sol.item_id, p_warehouse_id, 'DC', -v_stock_qty, v_avg_cost, 'delivery_challans', v_dc_id, 'Delivered via ' || v_dc_no);
      v_value := round(v_stock_qty * v_avg_cost, 2);
      v_stock_value_total := v_stock_value_total + v_value;
    end if;

    -- Advance any linked fabrication Job to Delivered once its SO line is fully delivered
    if v_sol.delivered_qty + v_qty >= v_sol.ordered_qty then
      for v_job in select * from public.jobs where sales_order_line_id = v_sol.id and status = 'ReadyForDispatch' loop
        update public.jobs set status = 'Delivered', progress_pct = 100 where id = v_job.id;
      end loop;
    end if;
  end loop;

  if v_stock_value_total > 0 then
    perform public._fn_post_journal_entry_core(
      coalesce(p_delivery_date, current_date), 'Delivery Challan ' || v_dc_no, 'delivery_challans', v_dc_id,
      jsonb_build_array(
        jsonb_build_object('account_code', v_cogs_account, 'party_id', null, 'debit', v_stock_value_total, 'credit', 0, 'memo', 'Cost of Goods Delivered'),
        jsonb_build_object('account_code', '1310', 'party_id', null, 'debit', 0, 'credit', v_stock_value_total, 'memo', 'Raw Material Inventory')
      )
    );
  end if;

  select bool_and(delivered_qty >= ordered_qty), bool_or(delivered_qty > 0)
    into v_all_delivered, v_any_delivered
    from public.sales_order_lines where sales_order_id = p_sales_order_id;

  update public.sales_orders
    set status = case when v_all_delivered then 'Delivered' when v_any_delivered then 'PartiallyDelivered' else status end
    where id = p_sales_order_id;

  return v_dc_id;
end;
$function$;

create or replace function public.fn_cancel_delivery_challan(p_dc_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_dc record;
  v_line record;
  v_avg_cost numeric;
  v_value numeric;
  v_reversal_qty numeric;
  v_stock_value_total numeric := 0;
  v_cogs_account text;
  v_business_line text;
  v_all_delivered boolean;
  v_any_delivered boolean;
begin
  if not public.is_owner() then
    raise exception 'Sirf Owner Delivery Challan cancel kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancel karne ki wajah likhna zaroori hai.';
  end if;

  select * into v_dc from public.delivery_challans where id = p_dc_id for update;
  if v_dc.id is null then
    raise exception 'DC nahi mili.';
  end if;
  if v_dc.status = 'Cancelled' then
    raise exception 'Yeh DC pehle se cancel hai.';
  end if;
  if exists (select 1 from public.invoices where sales_order_id = v_dc.sales_order_id and status = 'Posted') then
    raise exception 'Is Sales Order par invoice ban chuki hai — DC cancel nahi ho sakti.';
  end if;

  select business_line into v_business_line from public.sales_orders where id = v_dc.sales_order_id;
  v_cogs_account := case when v_business_line = 'fabrication' then '5010' else '5000' end;

  for v_line in select * from public.delivery_challan_lines where dc_id = p_dc_id loop
    update public.sales_order_lines
      set delivered_qty = delivered_qty - v_line.delivered_qty
      where id = v_line.sales_order_line_id;

    if v_line.issue_from_stock then
      v_reversal_qty := coalesce(v_line.stock_qty, v_line.delivered_qty);
      select avg_cost into v_avg_cost from public.stock_ledger
        where item_id = v_line.item_id and warehouse_id = v_dc.warehouse_id
        order by created_at desc, id desc limit 1;
      v_avg_cost := coalesce(v_avg_cost, 0);
      perform public._fn_post_stock_ledger(v_line.item_id, v_dc.warehouse_id, 'DC-Reversal', v_reversal_qty, v_avg_cost, 'delivery_challans', p_dc_id, 'Cancelled ' || v_dc.dc_no);
      v_value := round(v_reversal_qty * v_avg_cost, 2);
      v_stock_value_total := v_stock_value_total + v_value;
    end if;
  end loop;

  if v_stock_value_total > 0 then
    perform public._fn_post_journal_entry_core(
      current_date, 'Delivery Challan ' || v_dc.dc_no || ' — cancelled', 'delivery_challans', p_dc_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '1310', 'party_id', null, 'debit', v_stock_value_total, 'credit', 0, 'memo', 'Raw Material Inventory'),
        jsonb_build_object('account_code', v_cogs_account, 'party_id', null, 'debit', 0, 'credit', v_stock_value_total, 'memo', 'Cost of Goods Delivered — reversed')
      )
    );
  end if;

  select bool_and(delivered_qty >= ordered_qty), bool_or(delivered_qty > 0)
    into v_all_delivered, v_any_delivered
    from public.sales_order_lines where sales_order_id = v_dc.sales_order_id;

  update public.sales_orders
    set status = case when v_all_delivered then 'Delivered' when v_any_delivered then 'PartiallyDelivered' else 'Confirmed' end
    where id = v_dc.sales_order_id and status not in ('Cancelled','Closed');

  update public.delivery_challans set status = 'Cancelled', cancel_reason = p_reason where id = p_dc_id;
end;
$function$;
