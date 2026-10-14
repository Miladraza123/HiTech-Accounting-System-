-- Phase 48.04: optional "Project" text on the Delivery Challan form.
--
-- Plain text, not a master record. The challan form suggests the project names
-- already used on earlier challans of the same client.
-- fn_set_dc_project: sets it (Owner/Dispatch, issued challans only), used right
-- after a challan is created and from the challan page.

alter table public.delivery_challans add column if not exists project text;

create index if not exists idx_dc_party_project on public.delivery_challans (party_id) where project is not null;

create or replace function public.fn_set_dc_project(p_dc_id uuid, p_project text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not (public.is_owner() or public.has_role('dispatch')) then
    raise exception 'Only the Owner or Dispatch can edit Delivery Challan print details.';
  end if;

  select status into v_status from public.delivery_challans where id = p_dc_id for update;
  if v_status is null then
    raise exception 'Delivery Challan not found.';
  end if;
  if v_status = 'Cancelled' then
    raise exception 'A cancelled Delivery Challan cannot be edited.';
  end if;

  update public.delivery_challans
  set project = nullif(btrim(coalesce(p_project, '')), '')
  where id = p_dc_id;
end;
$$;

revoke execute on function public.fn_set_dc_project(uuid, text) from public, anon;
grant execute on function public.fn_set_dc_project(uuid, text) to authenticated;
