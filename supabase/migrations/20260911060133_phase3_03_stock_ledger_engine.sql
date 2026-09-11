-- The ONLY way any qty ever enters/leaves stock_ledger. Serializes
-- concurrent postings for the same item+warehouse via an advisory lock
-- (safe under multiple simultaneous users), maintains a running balance
-- and a weighted-average cost, and refuses to let stock go negative.
create or replace function public._fn_post_stock_ledger(
  p_item_id uuid,
  p_warehouse_id uuid,
  p_txn_type text,
  p_qty numeric,
  p_rate numeric,
  p_ref_table text,
  p_ref_id uuid,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_key bigint;
  v_prev_balance numeric := 0;
  v_prev_avg_cost numeric := 0;
  v_new_balance numeric;
  v_new_avg_cost numeric;
  v_id uuid;
begin
  v_lock_key := hashtextextended(p_item_id::text || ':' || p_warehouse_id::text, 0);
  perform pg_advisory_xact_lock(v_lock_key);

  select running_balance, avg_cost into v_prev_balance, v_prev_avg_cost
    from public.stock_ledger
    where item_id = p_item_id and warehouse_id = p_warehouse_id
    order by created_at desc, id desc
    limit 1;

  v_prev_balance := coalesce(v_prev_balance, 0);
  v_prev_avg_cost := coalesce(v_prev_avg_cost, 0);
  v_new_balance := v_prev_balance + p_qty;

  if v_new_balance < 0 then
    raise exception 'Stock negative nahi ho sakta (available %, requested %).', v_prev_balance, -p_qty;
  end if;

  if p_qty > 0 then
    if v_new_balance = 0 then
      v_new_avg_cost := 0;
    else
      v_new_avg_cost := ((v_prev_balance * v_prev_avg_cost) + (p_qty * p_rate)) / v_new_balance;
    end if;
  else
    v_new_avg_cost := case when v_new_balance = 0 then 0 else v_prev_avg_cost end;
  end if;

  insert into public.stock_ledger
    (item_id, warehouse_id, txn_type, qty, rate, running_balance, avg_cost, ref_table, ref_id, notes, created_by)
  values
    (p_item_id, p_warehouse_id, p_txn_type, p_qty, p_rate, v_new_balance, round(v_new_avg_cost, 4), p_ref_table, p_ref_id, p_notes, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public._fn_post_stock_ledger(uuid, uuid, text, numeric, numeric, text, uuid, text) from public, anon, authenticated;

create or replace function public._fn_recalc_po_totals(p_purchase_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtotal numeric;
  v_tax numeric;
begin
  select coalesce(sum(ordered_qty * rate), 0),
         coalesce(sum(ordered_qty * rate * tax_pct / 100), 0)
    into v_subtotal, v_tax
    from public.purchase_order_lines where purchase_order_id = p_purchase_order_id;

  update public.purchase_orders
    set subtotal = round(v_subtotal, 2),
        tax_total = round(v_tax, 2),
        grand_total = round(v_subtotal + v_tax, 2)
    where id = p_purchase_order_id;
end;
$$;

revoke execute on function public._fn_recalc_po_totals(uuid) from public, anon, authenticated;
