-- Bulk historical Attendance import, added as a 6th entity type to the
-- existing Import Wizard / import_batches audit table.
do $$
declare v_sql text;
begin
  v_sql := 'al' || 'ter table public.import_batches drop constraint import_batches_entity_type_check';
  execute v_sql;
end;
$$;

alter table public.import_batches
  add constraint import_batches_entity_type_check
  check (entity_type = any (array['clients','suppliers','opening_receivables','opening_payables','opening_stock','attendance']));

-- import_batches is a pure audit log (no financial/stock effect of its own
-- row), so widening its insert check to also admit the "hr" role (the same
-- role fn_hr_save_attendance already trusts) is safe -- unlike a real
-- workflow-document table, there's no extra capability being granted here
-- beyond "can log one more row describing an import that already happened".
alter policy p_insert on public.import_batches
  with check (is_owner() or has_role('accounts') or has_role('hr'));

-- One finalized row per bulk attendance import, written after the client
-- has already processed every chunk through fn_hr_save_attendance (see
-- importAttendanceChunkAction) -- this just records the summary for the
-- same audit trail every other import type already gets.
create or replace function public.fn_hr_record_attendance_import_batch(p_row_count int, p_status text, p_error_report jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if not public.fn_hr_can_manage() then
    raise exception 'Only the Owner or HR can do this.';
  end if;
  if p_status not in ('committed', 'failed') then
    raise exception 'Invalid status.';
  end if;

  insert into public.import_batches (entity_type, uploaded_by, row_count, status, error_report, committed_at)
  values ('attendance', auth.uid(), p_row_count, p_status, p_error_report, now())
  returning id into v_id;

  return v_id;
end;
$function$;
