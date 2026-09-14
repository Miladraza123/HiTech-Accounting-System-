-- Phase 29.01 — Master Offline-First Roadmap, Phase 1: offline-first CREATE
-- for the three master-data tables every later document (Query, Quotation,
-- Sales Order, Purchase Order, ...) references: Parties (clients/suppliers),
-- Items, and Warehouses.
--
-- Same pattern as fn_create_query_idempotent / fn_create_task_idempotent
-- (see 20260913010000_phase22_01_offline_first_query_create.sql and
-- 20260913030000_phase25_01_offline_first_task_create.sql): the browser
-- generates the row's UUID *before* going online, so two different offline
-- users can never collide on the same id; each function is safe to call
-- more than once with the same p_id (a retried sync after a dropped
-- connection just returns the existing row instead of a duplicate).
--
-- Genuinely low-risk offline creates: none of these three have a
-- sequential document number (fn_get_next_number) or any real-time
-- financial/stock check to re-validate at sync time — the only thing that
-- can legitimately fail at sync is a plain uniqueness collision
-- (item_code, warehouse code), which is exactly a normal, expected
-- 23505 unique_violation -> classified "permanent" by the client's own
-- retry classifier (offlineQueue.ts's RETRYABLE_PG_CODES), surfaced to the
-- user to fix rather than blindly retried forever.

create or replace function public.fn_create_party_idempotent(
  p_id uuid,
  p_party_type text,
  p_legal_name text,
  p_ntn text,
  p_strn text,
  p_cnic text,
  p_billing_address text,
  p_province text,
  p_credit_limit numeric,
  p_credit_days int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not (public.is_owner() or public.has_role('sales') or public.has_role('store')) then
    raise exception 'You do not have permission to create a Client/Supplier.';
  end if;

  select id into v_id from public.parties where id = p_id;
  if v_id is not null then
    return v_id;
  end if;

  if coalesce(trim(p_legal_name), '') = '' then
    raise exception 'Name is required.';
  end if;
  if p_party_type not in ('client', 'supplier', 'both') then
    raise exception 'Invalid party type.';
  end if;

  insert into public.parties (
    id, party_type, legal_name, ntn, strn, cnic, billing_address, province,
    credit_limit, credit_days, created_by
  )
  values (
    p_id, p_party_type, p_legal_name,
    nullif(trim(coalesce(p_ntn, '')), ''),
    nullif(trim(coalesce(p_strn, '')), ''),
    nullif(trim(coalesce(p_cnic, '')), ''),
    nullif(trim(coalesce(p_billing_address, '')), ''),
    nullif(trim(coalesce(p_province, '')), ''),
    coalesce(p_credit_limit, 0),
    coalesce(p_credit_days, 0),
    auth.uid()
  )
  -- Belt-and-suspenders against a genuine race (two near-simultaneous
  -- calls with the same id): the primary key constraint itself decides,
  -- atomically, which insert (if any) actually happens.
  on conflict (id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.parties where id = p_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.fn_create_party_idempotent(uuid, text, text, text, text, text, text, text, numeric, int) from public, anon;
grant execute on function public.fn_create_party_idempotent(uuid, text, text, text, text, text, text, text, numeric, int) to authenticated;


create or replace function public.fn_create_item_idempotent(
  p_id uuid,
  p_item_code text,
  p_description text,
  p_base_unit text,
  p_category text,
  p_spec text,
  p_hs_code text,
  p_tax_category text,
  p_is_stocked boolean,
  p_standard_cost numeric,
  p_reorder_level numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not (public.is_owner() or public.has_role('store') or public.has_role('production')) then
    raise exception 'You do not have permission to create an Item.';
  end if;

  select id into v_id from public.items where id = p_id;
  if v_id is not null then
    return v_id;
  end if;

  if coalesce(trim(p_item_code), '') = '' then
    raise exception 'Item code is required.';
  end if;
  if coalesce(trim(p_description), '') = '' then
    raise exception 'Description is required.';
  end if;
  if coalesce(trim(p_base_unit), '') = '' then
    raise exception 'Unit is required.';
  end if;

  insert into public.items (
    id, item_code, description, category, spec, base_unit, hs_code,
    tax_category, is_stocked, standard_cost, reorder_level
  )
  values (
    p_id, p_item_code, p_description,
    nullif(trim(coalesce(p_category, '')), ''),
    nullif(trim(coalesce(p_spec, '')), ''),
    p_base_unit,
    nullif(trim(coalesce(p_hs_code, '')), ''),
    coalesce(nullif(trim(p_tax_category), ''), 'standard'),
    coalesce(p_is_stocked, true),
    coalesce(p_standard_cost, 0),
    p_reorder_level
  )
  on conflict (id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.items where id = p_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.fn_create_item_idempotent(uuid, text, text, text, text, text, text, text, boolean, numeric, numeric) from public, anon;
grant execute on function public.fn_create_item_idempotent(uuid, text, text, text, text, text, text, text, boolean, numeric, numeric) to authenticated;


create or replace function public.fn_create_warehouse_idempotent(
  p_id uuid,
  p_code text,
  p_name text,
  p_address text
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
    raise exception 'You do not have permission to create a Warehouse.';
  end if;

  select id into v_id from public.warehouses where id = p_id;
  if v_id is not null then
    return v_id;
  end if;

  if coalesce(trim(p_code), '') = '' then
    raise exception 'Warehouse code is required.';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Warehouse name is required.';
  end if;

  insert into public.warehouses (id, code, name, address)
  values (p_id, upper(trim(p_code)), p_name, nullif(trim(coalesce(p_address, '')), ''))
  on conflict (id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.warehouses where id = p_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.fn_create_warehouse_idempotent(uuid, text, text, text) from public, anon;
grant execute on function public.fn_create_warehouse_idempotent(uuid, text, text, text) to authenticated;


-- Also extend the existing generic Smart Merge free-edit allowlist to
-- `warehouses` (name/address) — there was previously no way to edit a
-- warehouse at all once created (only toggle active/inactive), and Phase 1
-- of the roadmap promised "warehouses (create/edit)". `fn_smart_merge_update`
-- itself (see 20260912183951_phase18_03_smart_merge.sql, fixed by
-- phase18_04/phase18_05) is fully generic and driven entirely by this one
-- per-table column allowlist — it deliberately runs with the CALLER's own
-- privileges (not security definer), so `warehouses`' existing RLS UPDATE
-- policy (`is_owner() or has_role('store')`, see
-- 20260911040333_phase0_09_perf_indexes_and_policy_cleanup.sql) is exactly
-- what decides who may actually write here; nothing about the merge engine
-- itself needs to change, only which columns of which table it's allowed
-- to touch.
create or replace function public._fn_smart_merge_editable_columns(p_table_name text)
returns text[]
language sql
immutable
set search_path to 'public'
as $function$
  select case p_table_name
    when 'company' then array['legal_name','ntn','strn','address','province','phone','email','default_sales_tax_pct']
    when 'parties' then array['credit_limit','credit_days']
    when 'warehouses' then array['name','address']
    else null
  end;
$function$;
