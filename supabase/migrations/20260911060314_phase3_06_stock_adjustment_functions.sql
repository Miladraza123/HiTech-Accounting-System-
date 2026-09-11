create or replace function public.fn_request_stock_adjustment(
  p_item_id uuid,
  p_warehouse_id uuid,
  p_qty_delta numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not (public.is_owner() or public.has_role('store')) then
    raise exception 'Sirf Owner ya Store adjustment request kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Wajah likhna zaroori hai.';
  end if;
  if p_qty_delta = 0 then
    raise exception 'Qty delta zero nahi ho sakta.';
  end if;

  insert into public.stock_adjustments (item_id, warehouse_id, qty_delta, reason, requested_by)
  values (p_item_id, p_warehouse_id, p_qty_delta, p_reason, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- Owner-only: approving actually moves stock and posts the accounting
-- entry (shortage = expense, excess = income, per the blueprint's
-- posting table) at the item's current weighted-average cost.
create or replace function public.fn_approve_stock_adjustment(p_adjustment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_adj record;
  v_avg_cost numeric;
  v_value numeric;
begin
  if not public.is_owner() then
    raise exception 'Sirf Owner adjustment approve kar sakte hain.';
  end if;

  select * into v_adj from public.stock_adjustments where id = p_adjustment_id and status = 'Pending' for update;
  if v_adj.id is null then
    raise exception 'Yeh adjustment Pending nahi hai.';
  end if;

  select avg_cost into v_avg_cost
    from public.stock_ledger
    where item_id = v_adj.item_id and warehouse_id = v_adj.warehouse_id
    order by created_at desc, id desc limit 1;
  v_avg_cost := coalesce(v_avg_cost, 0);

  perform public._fn_post_stock_ledger(
    v_adj.item_id, v_adj.warehouse_id, 'Adjustment', v_adj.qty_delta, v_avg_cost, 'stock_adjustments', p_adjustment_id, v_adj.reason
  );

  v_value := round(abs(v_adj.qty_delta) * v_avg_cost, 2);
  if v_value > 0 then
    if v_adj.qty_delta < 0 then
      -- Shortage: Dr Inventory Adjustment (expense) / Cr Raw Material Inventory
      perform public._fn_post_journal_entry_core(
        current_date, 'Stock adjustment (shortage) — ' || v_adj.reason, 'stock_adjustments', p_adjustment_id,
        jsonb_build_array(
          jsonb_build_object('account_code','5900','debit',v_value,'credit',0,'memo','Inventory shortage'),
          jsonb_build_object('account_code','1310','debit',0,'credit',v_value,'memo','Raw Material Inventory')
        )
      );
    else
      -- Excess: Dr Raw Material Inventory / Cr Inventory Adjustment (income)
      perform public._fn_post_journal_entry_core(
        current_date, 'Stock adjustment (excess) — ' || v_adj.reason, 'stock_adjustments', p_adjustment_id,
        jsonb_build_array(
          jsonb_build_object('account_code','1310','debit',v_value,'credit',0,'memo','Raw Material Inventory'),
          jsonb_build_object('account_code','5900','debit',0,'credit',v_value,'memo','Inventory excess found')
        )
      );
    end if;
  end if;

  update public.stock_adjustments
    set status = 'Approved', decided_by = auth.uid(), decided_at = now()
    where id = p_adjustment_id;
end;
$$;

create or replace function public.fn_reject_stock_adjustment(p_adjustment_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Sirf Owner adjustment reject kar sakte hain.';
  end if;

  update public.stock_adjustments
    set status = 'Rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
    where id = p_adjustment_id and status = 'Pending';

  if not found then
    raise exception 'Yeh adjustment Pending nahi hai.';
  end if;
end;
$$;

revoke execute on function public.fn_request_stock_adjustment(uuid, uuid, numeric, text) from public, anon;
revoke execute on function public.fn_approve_stock_adjustment(uuid) from public, anon;
revoke execute on function public.fn_reject_stock_adjustment(uuid, text) from public, anon;

grant execute on function public.fn_request_stock_adjustment(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.fn_approve_stock_adjustment(uuid) to authenticated;
grant execute on function public.fn_reject_stock_adjustment(uuid, text) to authenticated;
