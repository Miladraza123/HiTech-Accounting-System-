-- Phase 46.05 — Job reserve guard + cancel a finished / material-holding Job
--
-- Same conventions as 20261006130000_phase46_04_followup_fixes.sql: every
-- existing function below is re-created from its LATEST definition (named in
-- each block), with signature, LANGUAGE, SECURITY, search_path unchanged, so
-- CREATE OR REPLACE keeps the existing grants; the revoke/grant lines from the
-- original migrations are re-applied anyway where they existed. No RLS policy,
-- is_owner / has_role or snapshot changes.
--
--   1. fn_reserve_job_material(_idempotent)  refuse on ReadyForDispatch / Delivered / Cancelled jobs
--   2. fn_cancel_job_with_disposition        NEW — Owner cancels a Job that holds issued material
--                                            (incl. ReadyForDispatch): convert the job cost into a
--                                            finished stock item, or return the materials to stock
--   3. fn_cancel_expense                     refuse once the expense was capitalised by (2)

-- ===========================================================================
-- 1. fn_reserve_job_material(_idempotent) — no reservations on finished jobs
-- ===========================================================================
-- Correction to the note in 20261006130000_phase46_04_followup_fixes.sql
-- (block 3): it said "Issue / reserve already refuse ReadyForDispatch /
-- Delivered / Cancelled". Only issue did — neither reserve function looked at
-- the job status at all, so free stock could be locked up against a job that
-- was finished, delivered or cancelled (and nothing would ever consume or
-- release it). Both now read the job row FOR UPDATE (serialising with issue /
-- cancel, which lock the same row) and refuse those three statuses. The
-- idempotent variant still returns an already-recorded reservation first, so
-- an offline replay of a reservation made earlier is not turned into an error.

-- fn_reserve_job_material
--
-- Latest definition: 20260913000700_phase21_02_translate_functions_batch_6.sql

CREATE OR REPLACE FUNCTION public.fn_reserve_job_material(p_job_id uuid, p_item_id uuid, p_warehouse_id uuid, p_qty numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_free_qty numeric;
  v_id uuid;
  v_job_status text;
begin
  if not (public.is_owner() or public.has_role('production') or public.has_role('store')) then
    raise exception 'You do not have permission to reserve materials.';
  end if;
  if p_qty <= 0 then
    raise exception 'Qty must be greater than zero.';
  end if;

  -- Phase 46.05: same terminal-status rule as issue / return.
  select status into v_job_status from public.jobs where id = p_job_id for update;
  if v_job_status is null then
    raise exception 'Job not found.';
  end if;
  if v_job_status in ('ReadyForDispatch', 'Delivered', 'Cancelled') then
    raise exception 'Material cannot be reserved on a Job that is %.', v_job_status;
  end if;

  if not exists (select 1 from public.job_material_requirements where job_id = p_job_id and item_id = p_item_id) then
    raise exception 'This item is not in this Job''s requirements.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_item_id::text || ':' || p_warehouse_id::text, 0));

  select free_qty into v_free_qty from public.stock_availability where item_id = p_item_id and warehouse_id = p_warehouse_id;
  if coalesce(v_free_qty, 0) < p_qty then
    raise exception 'Insufficient free stock (available %, requested %).', coalesce(v_free_qty, 0), p_qty;
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
$function$;
revoke execute on function public.fn_reserve_job_material(uuid, uuid, uuid, numeric) from public, anon;
grant execute on function public.fn_reserve_job_material(uuid, uuid, uuid, numeric) to authenticated;

-- fn_reserve_job_material_idempotent
--
-- Latest definition: 20260914080000_phase29_07_offline_first_fabrication_create.sql

CREATE OR REPLACE FUNCTION public.fn_reserve_job_material_idempotent(p_id uuid, p_job_id uuid, p_item_id uuid, p_warehouse_id uuid, p_qty numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing uuid;
  v_free_qty numeric;
  v_job_status text;
begin
  if not (public.is_owner() or public.has_role('production') or public.has_role('store')) then
    raise exception 'Only Owner, Production or Store can reserve material.';
  end if;

  select id into v_existing from public.stock_reservations where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_qty <= 0 then
    raise exception 'Qty must be greater than zero.';
  end if;

  -- Phase 46.05: same terminal-status rule as issue / return.
  select status into v_job_status from public.jobs where id = p_job_id for update;
  if v_job_status is null then
    raise exception 'Job not found.';
  end if;
  if v_job_status in ('ReadyForDispatch', 'Delivered', 'Cancelled') then
    raise exception 'Material cannot be reserved on a Job that is %.', v_job_status;
  end if;

  if not exists (select 1 from public.job_material_requirements where job_id = p_job_id and item_id = p_item_id) then
    raise exception 'This item is not in the Job material requirement.';
  end if;

  select free_qty into v_free_qty from public.stock_availability where item_id = p_item_id and warehouse_id = p_warehouse_id;
  if coalesce(v_free_qty, 0) < p_qty then
    raise exception 'Not enough free stock (available %, requested %).', coalesce(v_free_qty, 0), p_qty;
  end if;

  insert into public.stock_reservations (id, job_id, item_id, warehouse_id, reserved_qty, reservation_mode, created_by)
  values (p_id, p_job_id, p_item_id, p_warehouse_id, p_qty, 'manual', auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.stock_reservations where id = p_id;
    return v_existing;
  end if;

  update public.job_material_requirements
    set reserved_qty = reserved_qty + p_qty
    where job_id = p_job_id and item_id = p_item_id;

  perform public._fn_recalc_job_material_status(p_job_id);
  return p_id;
end;
$function$;
revoke execute on function public.fn_reserve_job_material_idempotent(uuid, uuid, uuid, uuid, numeric) from public, anon;
grant execute on function public.fn_reserve_job_material_idempotent(uuid, uuid, uuid, uuid, numeric) to authenticated;


-- ===========================================================================
-- 2. fn_cancel_job_with_disposition — Owner cancels a Job holding material
-- ===========================================================================
-- Dead end before this: fn_cancel_job refuses ReadyForDispatch and any job
-- with issued-not-returned material, fn_return_job_material refuses
-- ReadyForDispatch (46.04), and fn_cancel_sales_order refuses while a job is
-- not Cancelled (46.04). A finished job whose order fell through could never
-- be closed out.
--
-- Owner only, reason required. Allowed on any job that is not Delivered /
-- Cancelled and whose Sales Order line has no live (non-Cancelled) Delivery
-- Challan line — jobs link to DCs only through sales_order_line_id, so any
-- live DC line on that SO line counts as "goods of this job already went
-- out". fn_cancel_job stays as it is for jobs with no net issued material.
--
-- The job's WIP is the net of its job_cost_ledger 'material' rows (issue +,
-- return −); fn_issue / fn_return_job_material(_idempotent) post exactly that
-- amount Dr/Cr 1320 Work-in-Progress against 1310 Inventory, so the ledger
-- sum is the job's 1320 balance.
--
-- p_mode = 'convert'  The job becomes a finished stock item. Either an
--   existing active stocked item (p_item_id) or a NEW item (p_new_item:
--   {"item_code","description","base_unit"[,"category"]}), into p_warehouse_id
--   (default: the job's warehouse), p_qty > 0. Item cost = net material cost
--   (+ the job's Posted expenses when p_include_expenses). Stock ledger:
--   +p_qty at rate = cost / qty ('Return' row, ref jobs/job id — there is no
--   production txn_type and the row is stock coming back out of a job).
--   Journal: Dr 1310 cost / Cr 1320 material cost / Cr each expense head
--   account its capitalised amount (a reclass of what fn_create_expense
--   debited). Raw materials are NOT restocked (they were consumed).
--   job_cost_ledger: per raw item a 'material' row of −net value / −net qty
--   (so material nets to 0); when expenses are capitalised, one +'overhead'
--   row per expense (ref expenses/id — what fn_cancel_expense checks) and a
--   −'overhead' row for the total (so overhead also nets to 0).
--   With p_include_expenses = false the expenses stay as expenses.
--
-- p_mode = 'restock'  Every issued-not-returned raw material goes back to the
--   job's warehouse (where it was issued from) at its issue cost: rate = the
--   item's net job_cost_ledger value / net qty (not today's avg cost — that
--   is what fn_return_job_material uses, and it would leave WIP behind).
--   Per item: 'Return' stock row, job_material_events 'return' row,
--   returned_qty = issued_qty, job_cost_ledger −value / −qty. One journal
--   Dr 1310 / Cr 1320 for the job's whole WIP. Expenses stay as expenses.
--
-- Both: Active reservations → Released (reserved_qty → 0), job → Cancelled
-- with cancel_reason, an activity_timeline note. Journals are dated
-- current_date through _fn_post_journal_entry_core, so a locked period is
-- refused there. Returns the finished item id (convert) or null (restock).
create or replace function public.fn_cancel_job_with_disposition(
  p_job_id uuid,
  p_mode text,
  p_reason text,
  p_item_id uuid default null,
  p_new_item jsonb default null,
  p_warehouse_id uuid default null,
  p_qty numeric default null,
  p_include_expenses boolean default false
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job record;
  v_item record;
  v_item_id uuid;
  v_wh_id uuid;
  v_dc_no text;
  v_code text;
  v_desc text;
  v_unit text;
  v_material numeric := 0;
  v_expenses numeric := 0;
  v_total numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  v_row record;
  v_net_qty numeric;
  v_net_value numeric;
  v_note text;
begin
  if not public.is_owner() then
    raise exception 'Only the Owner can cancel a Job and dispose of its material.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason for cancelling is required.';
  end if;
  if p_mode is null or p_mode not in ('convert', 'restock') then
    raise exception 'Choose what happens to the Job''s material: convert to a finished item, or return to stock.';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'Job not found.';
  end if;
  if v_job.status in ('Delivered', 'Cancelled') then
    raise exception 'This Job cannot be cancelled at this stage (%).', v_job.status;
  end if;

  select d.dc_no into v_dc_no
    from public.delivery_challan_lines l
    join public.delivery_challans d on d.id = l.dc_id
    where l.sales_order_line_id = v_job.sales_order_line_id and d.status <> 'Cancelled'
    order by d.created_at
    limit 1;
  if v_dc_no is not null then
    raise exception 'Goods for this Job''s Sales Order line already went out on Delivery Challan % — cancel that Delivery Challan first.', v_dc_no;
  end if;

  -- Lock the job's requirement rows (issue / return update them).
  perform 1 from public.job_material_requirements where job_id = p_job_id for update;

  select coalesce(sum(amount), 0) into v_material
    from public.job_cost_ledger where job_id = p_job_id and cost_type = 'material';

  if p_mode = 'convert' then
    if p_qty is null or p_qty <= 0 then
      raise exception 'Qty must be greater than zero.';
    end if;
    if p_item_id is not null and p_new_item is not null then
      raise exception 'Pick an existing item or enter a new one — not both.';
    end if;

    if p_item_id is not null then
      select * into v_item from public.items where id = p_item_id;
      if v_item.id is null then
        raise exception 'Item not found.';
      end if;
      if not v_item.is_active or not v_item.is_stocked then
        raise exception 'Item % is not an active stocked item.', v_item.item_code;
      end if;
      v_item_id := v_item.id;
      v_code := v_item.item_code;
    elsif p_new_item is not null then
      v_code := trim(coalesce(p_new_item->>'item_code', ''));
      v_desc := trim(coalesce(p_new_item->>'description', ''));
      v_unit := trim(coalesce(p_new_item->>'base_unit', ''));
      if v_code = '' then
        raise exception 'Item code is required.';
      end if;
      if v_desc = '' then
        raise exception 'Description is required.';
      end if;
      if v_unit = '' then
        raise exception 'Unit is required.';
      end if;
      if not exists (select 1 from public.units where code = v_unit) then
        raise exception 'Unit % does not exist.', v_unit;
      end if;
      if exists (select 1 from public.items where lower(item_code) = lower(v_code)) then
        raise exception 'Item code % already exists — pick that item from the list instead.', v_code;
      end if;
      insert into public.items (item_code, description, category, base_unit, is_stocked)
      values (v_code, v_desc, nullif(trim(coalesce(p_new_item->>'category', '')), ''), v_unit, true)
      returning id into v_item_id;
    else
      raise exception 'Pick the finished item (or enter a new one).';
    end if;

    v_wh_id := coalesce(p_warehouse_id, v_job.warehouse_id);
    if not exists (select 1 from public.warehouses where id = v_wh_id and is_active) then
      raise exception 'Warehouse not found or inactive.';
    end if;

    if coalesce(p_include_expenses, false) then
      -- Locked so fn_cancel_expense (which locks the same row) cannot reverse
      -- one of them while it is being capitalised.
      perform 1 from public.expenses where job_id = p_job_id and status = 'Posted' for update;
      select coalesce(sum(amount), 0) into v_expenses
        from public.expenses where job_id = p_job_id and status = 'Posted';
    end if;

    v_total := v_material + v_expenses;
    if v_total < 0 then
      raise exception 'The Job''s net cost is negative (%) — it cannot be converted into stock.', v_total;
    end if;

    perform public._fn_post_stock_ledger(
      v_item_id, v_wh_id, 'Return', p_qty, v_total / p_qty, 'jobs', p_job_id,
      'Finished goods from cancelled Job ' || v_job.job_no
    );

    -- Material leaves WIP item by item.
    for v_row in
      select item_id, sum(amount) as amount, sum(coalesce(qty, 0)) as qty
        from public.job_cost_ledger
        where job_id = p_job_id and cost_type = 'material'
        group by item_id
        having sum(amount) <> 0
    loop
      insert into public.job_cost_ledger (job_id, cost_type, amount, qty, item_id, memo, ref_table, ref_id, created_by)
      values (p_job_id, 'material', -v_row.amount, nullif(-v_row.qty, 0), v_row.item_id,
              'Converted into ' || v_code || ' (Job cancelled)', 'items', v_item_id, auth.uid());
    end loop;

    if v_material > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_code', '1320', 'debit', 0, 'credit', v_material, 'memo', 'Work-in-Progress'));
    elsif v_material < 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_code', '1320', 'debit', -v_material, 'credit', 0, 'memo', 'Work-in-Progress'));
    end if;

    if v_expenses > 0 then
      for v_row in
        select e.id, e.expense_no, e.amount
          from public.expenses e
          where e.job_id = p_job_id and e.status = 'Posted'
          order by e.expense_no
      loop
        insert into public.job_cost_ledger (job_id, cost_type, amount, qty, item_id, memo, ref_table, ref_id, created_by)
        values (p_job_id, 'overhead', v_row.amount, null, null,
                'Expense ' || v_row.expense_no || ' capitalised', 'expenses', v_row.id, auth.uid());
      end loop;
      insert into public.job_cost_ledger (job_id, cost_type, amount, qty, item_id, memo, ref_table, ref_id, created_by)
      values (p_job_id, 'overhead', -v_expenses, null, null,
              'Capitalised into ' || v_code || ' (Job cancelled)', 'items', v_item_id, auth.uid());

      -- Reclass: credit back exactly the accounts fn_create_expense debited.
      for v_row in
        select h.account_code, string_agg(distinct h.name, ', ') as head_names, sum(e.amount) as amount
          from public.expenses e
          join public.expense_heads h on h.id = e.expense_head_id
          where e.job_id = p_job_id and e.status = 'Posted'
          group by h.account_code
          order by h.account_code
      loop
        v_lines := v_lines || jsonb_build_array(
          jsonb_build_object('account_code', v_row.account_code, 'debit', 0, 'credit', v_row.amount,
                             'memo', v_row.head_names || ' — capitalised'));
      end loop;
    end if;

    if v_total > 0 then
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code', '1310', 'debit', v_total, 'credit', 0, 'memo', 'Finished goods ' || v_code)
      ) || v_lines;
    end if;

    if jsonb_array_length(v_lines) > 0 then
      perform public._fn_post_journal_entry_core(
        current_date, 'Job ' || v_job.job_no || ' cancelled — converted into ' || v_code, 'jobs', p_job_id, v_lines
      );
    end if;

    v_note := 'Job cancelled — cost ' || v_total || ' converted into ' || p_qty || ' x ' || v_code
              || case when v_expenses > 0 then ' (incl. job expenses ' || v_expenses || ')' else '' end
              || '. Reason: ' || p_reason;
  else
    -- restock: every issued-not-returned raw material back at its issue cost.
    for v_row in
      select r.item_id, r.issued_qty - r.returned_qty as net_qty,
             coalesce((select sum(c.amount) from public.job_cost_ledger c
                        where c.job_id = p_job_id and c.cost_type = 'material' and c.item_id = r.item_id), 0) as net_value
        from public.job_material_requirements r
        where r.job_id = p_job_id
        order by r.item_id
    loop
      v_net_qty := v_row.net_qty;
      v_net_value := v_row.net_value;
      continue when v_net_qty <= 0 and v_net_value = 0;

      if v_net_qty > 0 then
        perform public._fn_post_stock_ledger(
          v_row.item_id, v_job.warehouse_id, 'Return', v_net_qty, greatest(v_net_value, 0) / v_net_qty, 'jobs', p_job_id,
          'Returned from cancelled Job ' || v_job.job_no
        );
        update public.job_material_requirements
          set returned_qty = issued_qty
          where job_id = p_job_id and item_id = v_row.item_id;
        insert into public.job_material_events (id, job_id, item_id, event_type, qty, created_by)
        values (gen_random_uuid(), p_job_id, v_row.item_id, 'return', v_net_qty, auth.uid());
      end if;

      if v_net_value <> 0 then
        insert into public.job_cost_ledger (job_id, cost_type, amount, qty, item_id, memo, ref_table, ref_id, created_by)
        values (p_job_id, 'material', -v_net_value, nullif(-greatest(v_net_qty, 0), 0), v_row.item_id,
                'Material returned (Job cancelled)', 'stock_ledger', p_job_id, auth.uid());
      end if;
    end loop;

    if v_material <> 0 then
      perform public._fn_post_journal_entry_core(
        current_date, 'Job ' || v_job.job_no || ' cancelled — material returned to stock', 'jobs', p_job_id,
        case when v_material > 0 then
          jsonb_build_array(
            jsonb_build_object('account_code', '1310', 'debit', v_material, 'credit', 0, 'memo', 'Raw Material Inventory'),
            jsonb_build_object('account_code', '1320', 'debit', 0, 'credit', v_material, 'memo', 'Work-in-Progress'))
        else
          jsonb_build_array(
            jsonb_build_object('account_code', '1320', 'debit', -v_material, 'credit', 0, 'memo', 'Work-in-Progress'),
            jsonb_build_object('account_code', '1310', 'debit', 0, 'credit', -v_material, 'memo', 'Raw Material Inventory'))
        end
      );
    end if;

    v_note := 'Job cancelled — issued material returned to stock (value ' || v_material || '). Reason: ' || p_reason;
  end if;

  update public.stock_reservations set status = 'Released' where job_id = p_job_id and status = 'Active';
  update public.job_material_requirements set reserved_qty = 0 where job_id = p_job_id;

  update public.jobs
    set status = 'Cancelled', cancel_reason = p_reason, updated_by = auth.uid()
    where id = p_job_id;

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('jobs', p_job_id, 'status_change', v_note, auth.uid());

  return v_item_id;
end;
$function$;
revoke execute on function public.fn_cancel_job_with_disposition(uuid, text, text, uuid, jsonb, uuid, numeric, boolean) from public, anon;
grant execute on function public.fn_cancel_job_with_disposition(uuid, text, text, uuid, jsonb, uuid, numeric, boolean) to authenticated;


-- ===========================================================================
-- 3. fn_cancel_expense — not once capitalised into stock
-- ===========================================================================
-- After (2) capitalised a job expense (Dr 1310 / Cr the expense account), a
-- normal cancel (Dr cash-bank / Cr the expense account) would refund the cash
-- while the cost sits in inventory, leaving the expense account negative.
-- (2) writes one job_cost_ledger row per capitalised expense
-- (ref_table = 'expenses', ref_id = expense id); its presence blocks cancel.

-- fn_cancel_expense
--
-- Latest definition: 20261006130000_phase46_04_followup_fixes.sql

CREATE OR REPLACE FUNCTION public.fn_cancel_expense(p_expense_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_exp record;
  v_head record;
  v_credit_account_code text;
  v_prev_reading numeric;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can cancel Expenses.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason for cancelling is required.';
  end if;

  select * into v_exp from public.expenses where id = p_expense_id for update;
  if v_exp.id is null then
    raise exception 'Expense not found.';
  end if;
  if v_exp.status = 'Cancelled' then
    raise exception 'This Expense is already cancelled.';
  end if;
  -- Phase 46.05: capitalised into a finished item when its Job was cancelled.
  if exists (select 1 from public.job_cost_ledger
             where ref_table = 'expenses' and ref_id = p_expense_id) then
    raise exception 'This Expense was capitalised into stock when its Job was cancelled — it cannot be cancelled.';
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

  update public.expenses
    set status = 'Cancelled', cancel_reason = p_reason, updated_by = auth.uid(), updated_at = now()
    where id = p_expense_id;

  -- Phase 46.04: roll the vehicle meter back if this expense set it.
  if v_exp.vehicle_id is not null and v_exp.odometer_reading is not null then
    perform 1 from public.vehicles where id = v_exp.vehicle_id for update;
    select max(e.odometer_reading) into v_prev_reading
      from public.expenses e
      where e.vehicle_id = v_exp.vehicle_id and e.id <> p_expense_id
        and e.status <> 'Cancelled' and e.odometer_reading is not null;
    update public.vehicles v
      set current_meter_reading = greatest(v.opening_meter_reading, coalesce(v_prev_reading, v.opening_meter_reading)),
          updated_by = auth.uid(), updated_at = now()
      where v.id = v_exp.vehicle_id and v.current_meter_reading = v_exp.odometer_reading;
  end if;
end;
$function$;
