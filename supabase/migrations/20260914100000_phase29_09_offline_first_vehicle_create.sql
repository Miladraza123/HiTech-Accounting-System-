-- Phase 29.09 — Master Offline-First Roadmap, Phase 11 (addendum,
-- explicitly requested by the user after Phase 10's "deliberately out of
-- scope" report named it): offline-first Vehicle creation.
--
-- Sub-audit finding: createVehicleAction (src/app/actions/vehicles.ts)
-- has never gone through any RPC at all, online or offline — a plain
-- direct `.insert()` relying solely on RLS, unlike every other
-- master-data create in this app since Phase 1. Fixed here with the
-- exact same idempotent-create-RPC pattern as Party/Item/Warehouse
-- (Phase 1): client-generated UUID, safe to call twice with the same id,
-- gated the same way vehicles' own existing RLS insert policy already
-- gates it (Owner or Accounts — public.vehicles' p_insert policy).
--
-- Mirrors createVehicleAction's exact current insert logic, including
-- its status/current_meter_reading derivation — no new business rule
-- introduced, purely offline-enabling what already works online.

create or replace function public.fn_create_vehicle_idempotent(
  p_id uuid,
  p_vehicle_no text,
  p_registration_no text,
  p_vehicle_type text,
  p_make_model text,
  p_assigned_user_id uuid,
  p_assignment_date date,
  p_opening_meter_reading numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can create a Vehicle.';
  end if;

  select id into v_existing from public.vehicles where id = p_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if coalesce(trim(p_vehicle_no), '') = '' then
    raise exception 'Vehicle number is required.';
  end if;

  insert into public.vehicles
    (id, vehicle_no, registration_no, vehicle_type, make_model, assigned_user_id, assignment_date,
     opening_meter_reading, current_meter_reading, status, created_by)
  values
    (p_id, p_vehicle_no, p_registration_no, p_vehicle_type, p_make_model, p_assigned_user_id, p_assignment_date,
     coalesce(p_opening_meter_reading, 0), coalesce(p_opening_meter_reading, 0),
     case when p_assigned_user_id is not null then 'Active' else 'Unassigned' end,
     auth.uid())
  on conflict (id) do nothing
  returning id into v_existing;

  if v_existing is null then
    select id into v_existing from public.vehicles where id = p_id;
  end if;

  return v_existing;
end;
$$;

revoke execute on function public.fn_create_vehicle_idempotent(uuid, text, text, text, text, uuid, date, numeric) from public, anon;
grant execute on function public.fn_create_vehicle_idempotent(uuid, text, text, text, text, uuid, date, numeric) to authenticated;
