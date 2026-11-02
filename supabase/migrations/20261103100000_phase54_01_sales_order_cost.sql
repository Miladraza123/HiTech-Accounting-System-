-- Phase 54: what an order is expected to cost us, and how it is turning out.
--
-- * sales_order_costs holds one "estimated cost" per Sales Order. It lives in its
--   own table (not a column on sales_orders) because sales_orders is readable by
--   every signed-in user while cost and margin are for Owner and Accounts only.
-- * fn_set_sales_order_estimated_cost writes it (create or change; NULL clears it).
--   Changes are audited (who / when / old -> new) by the generic audit trigger.
-- * fn_sales_order_cost_summary returns, for Owner/Accounts, the order's selling
--   value next to the estimated cost and the actual cost so far (linked, non-cancelled
--   Purchase Orders + the fabrication job cost ledger), with the resulting profit.

create table if not exists public.sales_order_costs (
  sales_order_id uuid primary key references public.sales_orders(id) on delete cascade,
  estimated_cost numeric(14, 2) not null check (estimated_cost >= 0),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.sales_order_costs enable row level security;
drop policy if exists p_select on public.sales_order_costs;
create policy p_select on public.sales_order_costs for select to authenticated
  using (public.is_owner() or public.has_role('accounts') or public.has_role('backup'));  -- 'backup' = the Daily Backup bot
-- written only through fn_set_sales_order_estimated_cost
revoke all on public.sales_order_costs from anon, authenticated;
grant select on public.sales_order_costs to authenticated;

drop trigger if exists trg_audit on public.sales_order_costs;
create trigger trg_audit after insert or update or delete on public.sales_order_costs
  for each row execute function public.fn_audit_row();

create or replace function public.fn_set_sales_order_estimated_cost(p_sales_order_id uuid, p_cost numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can set an order''s cost.';
  end if;
  if p_cost is not null and p_cost < 0 then
    raise exception 'Cost cannot be negative.';
  end if;

  select status into v_status from public.sales_orders where id = p_sales_order_id for update;
  if not found then
    raise exception 'Sales Order not found.';
  end if;
  if v_status = 'Cancelled' then
    raise exception 'A cancelled Sales Order cannot be edited.';
  end if;

  if p_cost is null then
    delete from public.sales_order_costs where sales_order_id = p_sales_order_id;
  else
    insert into public.sales_order_costs (sales_order_id, estimated_cost, updated_by)
    values (p_sales_order_id, round(p_cost, 2), auth.uid())
    on conflict (sales_order_id) do update
      set estimated_cost = excluded.estimated_cost, updated_by = auth.uid(), updated_at = now()
      where public.sales_order_costs.estimated_cost is distinct from excluded.estimated_cost;
  end if;
end;
$$;

create or replace function public.fn_sales_order_cost_summary(p_sales_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_subtotal numeric;
  v_estimated numeric;
  v_po_cost numeric;
  v_po_count int;
  v_job_cost numeric;
  v_actual numeric;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can see an order''s cost.';
  end if;

  select subtotal into v_subtotal from public.sales_orders where id = p_sales_order_id;
  if not found then
    raise exception 'Sales Order not found.';
  end if;

  select estimated_cost into v_estimated from public.sales_order_costs where sales_order_id = p_sales_order_id;

  select coalesce(sum(subtotal), 0), count(*) into v_po_cost, v_po_count
    from public.purchase_orders
    where linked_sales_order_id = p_sales_order_id and status <> 'Cancelled';

  select coalesce(sum(l.amount), 0) into v_job_cost
    from public.job_cost_ledger l
    join public.jobs j on j.id = l.job_id
    where j.sales_order_id = p_sales_order_id;

  v_actual := v_po_cost + v_job_cost;

  return jsonb_build_object(
    'sales_subtotal', v_subtotal,
    'estimated_cost', v_estimated,
    'po_cost', v_po_cost,
    'po_count', v_po_count,
    'job_cost', v_job_cost,
    'actual_cost', v_actual,
    'estimated_profit', case when v_estimated is null then null else v_subtotal - v_estimated end,
    'actual_profit', v_subtotal - v_actual
  );
end;
$$;

revoke all on function public.fn_set_sales_order_estimated_cost(uuid, numeric) from public, anon;
grant execute on function public.fn_set_sales_order_estimated_cost(uuid, numeric) to authenticated;
revoke all on function public.fn_sales_order_cost_summary(uuid) from public, anon;
grant execute on function public.fn_sales_order_cost_summary(uuid) to authenticated;

-- ---- Backup / Restore: both new tables must be restorable ------------------------
-- fn_admin_restore_* only accept tables _fn_restore_pk_columns knows. This adds
-- sales_order_costs (this migration) and purchase_order_revisions (phase 52, which had
-- been added to the backup lists but not here, so a restore would have refused it).
do $patch$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public._fn_restore_pk_columns(text)'::regprocedure) into v_def;
  if v_def like '%sales_order_costs%' and v_def like '%purchase_order_revisions%' then
    return;
  end if;
  v_new := v_def;
  if v_new not like '%purchase_order_revisions%' then
    v_new := replace(v_new, 'else null', E'when ''purchase_order_revisions'' then array[''id'']\n    else null');
  end if;
  if v_new not like '%sales_order_costs%' then
    v_new := replace(v_new, 'else null', E'when ''sales_order_costs'' then array[''sales_order_id'']\n    else null');
  end if;
  if v_new = v_def then
    raise exception '_fn_restore_pk_columns patch did not apply';
  end if;
  execute v_new;
end
$patch$;
