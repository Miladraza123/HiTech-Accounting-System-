-- ============================================================
-- Bug fix: fn_record_pod inserted activity_timeline.event_type = 'pod',
-- but activity_timeline_event_type_check only allows
-- 'note' | 'status_change' | 'followup' | 'system'. Every real POD
-- recorded with a note would fail this CHECK constraint and roll back
-- the whole POD (including the acceptance_status update) — this was
-- never caught before because the app had zero real production usage
-- until now. 'status_change' is the correct value (matches the
-- semantically identical pattern already used by fn_cancel_sales_order
-- for its own "status changed" timeline entries).
-- ============================================================

create or replace function public.fn_record_pod(p_dc_id uuid, p_accepted_by_name text, p_note text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not (public.is_owner() or public.has_role('dispatch')) then
    raise exception 'Sirf Owner ya Dispatch POD record kar sakte hain.';
  end if;
  if coalesce(trim(p_accepted_by_name), '') = '' then
    raise exception 'Accept karne wale ka naam likhna zaroori hai.';
  end if;

  update public.delivery_challans
    set acceptance_status = 'Accepted', accepted_by_name = p_accepted_by_name, accepted_at = now(), dispute_note = null
    where id = p_dc_id and status = 'Issued';
  if not found then
    raise exception 'DC nahi mili ya cancel ho chuki hai.';
  end if;

  if coalesce(trim(p_note), '') <> '' then
    insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
    values ('delivery_challans', p_dc_id, 'status_change', p_note, auth.uid());
  end if;
end;
$function$;
