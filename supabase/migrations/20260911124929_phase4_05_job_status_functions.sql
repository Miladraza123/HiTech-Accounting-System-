-- Progress updates: once fabrication has started, moving progress above 0%
-- advances the Job into InProcess (a one-way step — never reverts to
-- FabricationStarted if progress is edited back down, that would be a
-- confusing status flap for a simple progress correction).
create or replace function public.fn_update_job_progress(p_job_id uuid, p_progress_pct int, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not (public.is_owner() or public.has_role('production')) then
    raise exception 'Sirf Owner ya Production progress update kar sakte hain.';
  end if;
  if p_progress_pct < 0 or p_progress_pct > 100 then
    raise exception 'Progress 0-100 ke darmiyan honi chahiye.';
  end if;

  select status into v_status from public.jobs where id = p_job_id;
  if v_status is null then
    raise exception 'Job nahi mili.';
  end if;
  if v_status in ('ReadyForDispatch','Delivered','Cancelled') then
    raise exception 'Is stage par progress update nahi ho sakti (%).', v_status;
  end if;

  update public.jobs
    set progress_pct = p_progress_pct,
        status = case when status = 'FabricationStarted' and p_progress_pct > 0 then 'InProcess' else status end
    where id = p_job_id;

  if coalesce(trim(p_note), '') <> '' then
    insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
    values ('jobs', p_job_id, 'note', p_note, auth.uid());
  end if;
end;
$$;

create or replace function public.fn_mark_job_ready_for_dispatch(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_owner() or public.has_role('production')) then
    raise exception 'Sirf Owner ya Production yeh kar sakte hain.';
  end if;

  update public.jobs
    set status = 'ReadyForDispatch', progress_pct = 100
    where id = p_job_id and status in ('FabricationStarted','InProcess');

  if not found then
    raise exception 'Job abhi Ready for Dispatch mark nahi ho sakti — fabrication shuru honi chahiye.';
  end if;
end;
$$;

create or replace function public.fn_cancel_job(p_job_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not (public.is_owner() or public.has_role('production')) then
    raise exception 'Sirf Owner ya Production cancel kar sakte hain.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancel karne ki wajah likhna zaroori hai.';
  end if;

  select status into v_status from public.jobs where id = p_job_id;
  if v_status is null then
    raise exception 'Job nahi mili.';
  end if;
  if v_status in ('ReadyForDispatch','Delivered','Cancelled') then
    raise exception 'Is stage par Job cancel nahi ho sakti (%).', v_status;
  end if;
  if exists (select 1 from public.job_material_requirements where job_id = p_job_id and issued_qty > returned_qty) then
    raise exception 'Jis Job ka material issue ho chuka hai (wapis nahi hua) usay cancel nahi kar sakte — pehle material return karen.';
  end if;

  update public.stock_reservations set status = 'Released' where job_id = p_job_id and status = 'Active';
  update public.job_material_requirements set reserved_qty = 0 where job_id = p_job_id;

  update public.jobs set status = 'Cancelled', cancel_reason = p_reason where id = p_job_id;
end;
$$;

revoke execute on function public.fn_update_job_progress(uuid, int, text) from public, anon;
revoke execute on function public.fn_mark_job_ready_for_dispatch(uuid) from public, anon;
revoke execute on function public.fn_cancel_job(uuid, text) from public, anon;

grant execute on function public.fn_update_job_progress(uuid, int, text) to authenticated;
grant execute on function public.fn_mark_job_ready_for_dispatch(uuid) to authenticated;
grant execute on function public.fn_cancel_job(uuid, text) to authenticated;
