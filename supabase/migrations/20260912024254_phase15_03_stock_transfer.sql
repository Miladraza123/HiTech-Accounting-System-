-- ============================================================
-- Phase 15 part C: Stock Transfer between warehouses. Purely a
-- stock_ledger (sub-ledger) movement — 1310 Raw Material Inventory is a
-- single company-wide GL account (journal_lines has no warehouse
-- dimension), so moving stock between warehouses changes zero GL
-- balances and needs no journal entry at all, unlike every other
-- stock-moving document in this system.
-- ============================================================

insert into public.numbering_sequences (doc_type, label, prefix, fy_reset, padding, current_value)
values ('STN', 'Stock Transfer', 'STN-', true, 4, 0);

create table public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_no text not null unique,
  from_warehouse_id uuid not null references public.warehouses(id),
  to_warehouse_id uuid not null references public.warehouses(id),
  transfer_date date not null default current_date,
  remarks text,
  status text not null default 'Posted' check (status in ('Posted','Cancelled')),
  cancel_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  check (from_warehouse_id <> to_warehouse_id)
);

create table public.stock_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
  item_id uuid not null references public.items(id),
  qty numeric not null check (qty > 0),
  rate numeric not null default 0,
  sort_order integer not null default 0
);

create index idx_stock_transfers_from on public.stock_transfers(from_warehouse_id);
create index idx_stock_transfers_to on public.stock_transfers(to_warehouse_id);
create index idx_stock_transfer_lines_transfer on public.stock_transfer_lines(transfer_id);

create trigger trg_audit after insert or delete or update on public.stock_transfers for each row execute function fn_audit_row();
create trigger trg_updated_at before update on public.stock_transfers for each row execute function fn_set_updated_at();

alter table public.stock_transfers enable row level security;
create policy p_select on public.stock_transfers for select using (true);
create policy p_insert on public.stock_transfers for insert with check (public.is_owner() or public.has_role('store'));
create policy p_update on public.stock_transfers for update using (public.is_owner() or public.has_role('store')) with check (public.is_owner() or public.has_role('store'));

alter table public.stock_transfer_lines enable row level security;
create policy p_select on public.stock_transfer_lines for select using (true);
create policy p_insert on public.stock_transfer_lines for insert with check (public.is_owner() or public.has_role('store'));

create or replace function public.fn_create_stock_transfer(
  p_from_warehouse_id uuid, p_to_warehouse_id uuid, p_transfer_date date, p_remarks text, p_lines jsonb
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_transfer_id uuid;
  v_transfer_no text;
  v_line jsonb;
  v_item_id uuid;
  v_qty numeric;
  v_avg_cost numeric;
begin
  if not (public.is_owner() or public.has_role('store')) then
    raise exception 'Sirf Owner ya Store Stock Transfer bana sakte hain.';
  end if;
  if p_from_warehouse_id = p_to_warehouse_id then
    raise exception 'From aur To warehouse alag hone chahiye.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Transfer mein kam az kam ek item honi chahiye.';
  end if;

  select public.fn_get_next_number('STN') into v_transfer_no;

  insert into public.stock_transfers (transfer_no, from_warehouse_id, to_warehouse_id, transfer_date, remarks, created_by)
  values (v_transfer_no, p_from_warehouse_id, p_to_warehouse_id, coalesce(p_transfer_date, current_date), p_remarks, auth.uid())
  returning id into v_transfer_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item_id := (v_line->>'item_id')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    if v_qty <= 0 then
      raise exception 'Transfer qty zero se zyada honi chahiye.';
    end if;

    select avg_cost into v_avg_cost from public.stock_ledger
      where item_id = v_item_id and warehouse_id = p_from_warehouse_id
      order by created_at desc, id desc limit 1;
    v_avg_cost := coalesce(v_avg_cost, 0);

    insert into public.stock_transfer_lines (transfer_id, item_id, qty, rate, sort_order)
    values (v_transfer_id, v_item_id, v_qty, v_avg_cost, 0);

    -- Fails on insufficient stock at source (the same negative-balance
    -- guard every other stock movement in this system relies on).
    perform public._fn_post_stock_ledger(v_item_id, p_from_warehouse_id, 'STN', -v_qty, v_avg_cost, 'stock_transfers', v_transfer_id, 'Transfer ' || v_transfer_no || ' — out');
    perform public._fn_post_stock_ledger(v_item_id, p_to_warehouse_id, 'STN', v_qty, v_avg_cost, 'stock_transfers', v_transfer_id, 'Transfer ' || v_transfer_no || ' — in');
  end loop;

  return v_transfer_id;
end;
$function$;

create or replace function public.fn_cancel_stock_transfer(p_transfer_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_transfer record;
  v_line record;
begin
  if not (public.is_owner() or public.has_role('store')) then
    raise exception 'Sirf Owner ya Store Stock Transfer cancel kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancel karne ki wajah likhna zaroori hai.';
  end if;

  select * into v_transfer from public.stock_transfers where id = p_transfer_id for update;
  if v_transfer.id is null then
    raise exception 'Stock Transfer nahi mili.';
  end if;
  if v_transfer.status = 'Cancelled' then
    raise exception 'Yeh Stock Transfer pehle se cancel hai.';
  end if;

  for v_line in select * from public.stock_transfer_lines where transfer_id = p_transfer_id loop
    -- Reverse: remove from destination (fails if already consumed there),
    -- add back to source.
    perform public._fn_post_stock_ledger(v_line.item_id, v_transfer.to_warehouse_id, 'STN', -v_line.qty, 0, 'stock_transfers', p_transfer_id, 'Transfer ' || v_transfer.transfer_no || ' — cancelled');
    perform public._fn_post_stock_ledger(v_line.item_id, v_transfer.from_warehouse_id, 'STN', v_line.qty, v_line.rate, 'stock_transfers', p_transfer_id, 'Transfer ' || v_transfer.transfer_no || ' — cancelled');
  end loop;

  update public.stock_transfers set status = 'Cancelled', cancel_reason = p_reason where id = p_transfer_id;
end;
$function$;
