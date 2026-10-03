-- Phase 41.02 — Dispatch Go-Ahead RPCs + notification helpers.

-- Non-sensitive (just id + name of role-holders) — any signed-in user may
-- call this, mirroring how TasksPanel's assignee picker already reads the
-- full `profiles` list with no role filter at the RLS level.
create or replace function public.fn_list_users_by_role(p_role_code text)
returns table (id uuid, full_name text)
language sql
security definer
set search_path = public
as $$
  select p.id, p.full_name
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id
  join public.roles r on r.id = ur.role_id
  where r.code = p_role_code and p.is_active
  order by p.full_name;
$$;

grant execute on function public.fn_list_users_by_role(text) to authenticated;

create or replace function public.fn_create_dispatch_go_ahead(p_delivery_challan_id uuid, p_given_to uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dc record;
  v_go_ahead_id uuid;
  v_given_to_name text;
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Sirf Owner ya Sales Dispatch Go-Ahead de sakte hain.';
  end if;

  select * into v_dc from public.delivery_challans where id = p_delivery_challan_id;
  if v_dc.id is null then
    raise exception 'Delivery Challan nahi mili.';
  end if;

  if not exists (
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = p_given_to and r.code = 'dispatch'
  ) then
    raise exception 'Yeh user Dispatch role mein nahi hai.';
  end if;

  insert into public.dispatch_go_aheads (delivery_challan_id, given_by, given_to)
  values (p_delivery_challan_id, auth.uid(), p_given_to)
  returning id into v_go_ahead_id;

  insert into public.notifications (recipient_user_id, type, title, description, href, related_table, related_id)
  values (
    p_given_to, 'dispatch_go_ahead_received', 'Delivery Go-Ahead — ' || v_dc.dc_no,
    'Accept to confirm you are taking this delivery.', '/delivery-challans/' || p_delivery_challan_id,
    'delivery_challans', p_delivery_challan_id
  );

  return v_go_ahead_id;
end;
$$;

revoke execute on function public.fn_create_dispatch_go_ahead(uuid, uuid) from public, anon;
grant execute on function public.fn_create_dispatch_go_ahead(uuid, uuid) to authenticated;

create or replace function public.fn_accept_dispatch_go_ahead(p_go_ahead_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ga record;
  v_dc record;
  v_my_name text;
begin
  select * into v_ga from public.dispatch_go_aheads where id = p_go_ahead_id for update;
  if v_ga.id is null then
    raise exception 'Go-Ahead nahi mili.';
  end if;
  if not (v_ga.given_to = auth.uid() or public.is_owner()) then
    raise exception 'Sirf jisko Go-Ahead diya gaya hai wohi accept kar sakta hai.';
  end if;
  if v_ga.status <> 'Pending' then
    raise exception 'Yeh Go-Ahead "Pending" nahi hai (abhi: %).', v_ga.status;
  end if;

  update public.dispatch_go_aheads set status = 'Accepted', accepted_at = now() where id = p_go_ahead_id;

  select * into v_dc from public.delivery_challans where id = v_ga.delivery_challan_id;
  select full_name into v_my_name from public.profiles where id = v_ga.given_to;

  insert into public.notifications (recipient_user_id, type, title, description, href, related_table, related_id)
  values (
    v_ga.given_by, 'dispatch_go_ahead_accepted', 'Accepted — ' || coalesce(v_dc.dc_no, ''),
    coalesce(v_my_name, 'Dispatch') || ' ne delivery accept kar li hai.', '/delivery-challans/' || v_ga.delivery_challan_id,
    'delivery_challans', v_ga.delivery_challan_id
  );
end;
$$;

revoke execute on function public.fn_accept_dispatch_go_ahead(uuid) from public, anon;
grant execute on function public.fn_accept_dispatch_go_ahead(uuid) to authenticated;

create or replace function public.fn_complete_dispatch_go_ahead(p_go_ahead_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ga record;
  v_dc record;
begin
  select * into v_ga from public.dispatch_go_aheads where id = p_go_ahead_id for update;
  if v_ga.id is null then
    raise exception 'Go-Ahead nahi mili.';
  end if;
  if not (v_ga.given_to = auth.uid() or public.is_owner()) then
    raise exception 'Sirf jisko Go-Ahead diya gaya hai wohi complete kar sakta hai.';
  end if;
  if v_ga.status <> 'Accepted' then
    raise exception 'Yeh Go-Ahead "Accepted" nahi hai (abhi: %).', v_ga.status;
  end if;

  update public.dispatch_go_aheads set status = 'Completed', completed_at = now() where id = p_go_ahead_id;

  select * into v_dc from public.delivery_challans where id = v_ga.delivery_challan_id;

  insert into public.notifications (recipient_user_id, type, title, description, href, related_table, related_id)
  values (
    v_ga.given_by, 'dispatch_go_ahead_completed', 'Delivery Complete — ' || coalesce(v_dc.dc_no, ''),
    'Delivery mukammal ho chuki hai.', '/delivery-challans/' || v_ga.delivery_challan_id,
    'delivery_challans', v_ga.delivery_challan_id
  );
end;
$$;

revoke execute on function public.fn_complete_dispatch_go_ahead(uuid) from public, anon;
grant execute on function public.fn_complete_dispatch_go_ahead(uuid) to authenticated;

create or replace function public.fn_mark_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications
    set is_read = true
    where id = p_notification_id and recipient_user_id = auth.uid();
end;
$$;

grant execute on function public.fn_mark_notification_read(uuid) to authenticated;
