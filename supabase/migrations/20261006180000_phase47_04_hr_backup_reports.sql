-- Phase 47.04: HR / Attendance, part (e): backups and reports.
--
--  * The daily backup bot (role "backup") can read the HR tables, and the
--    in-app Restore accepts them (restore allowlist below). The table
--    order lives in src/lib/restoreTableOrder.ts and backup/backup.js.
--  * fn_hr_register: one month's attendance grid for the register report
--    and its Excel export.

-- ---------------------------------------------------------------------------
-- 1. Backup bot can read HR
-- ---------------------------------------------------------------------------
create or replace function public.fn_hr_can_read()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_owner() or public.has_role('hr') or public.has_role('accounts')
      or public.has_role('auditor') or public.has_role('backup');
$$;

-- ---------------------------------------------------------------------------
-- 2. Restore allowlist (same list as before plus the HR tables)
-- ---------------------------------------------------------------------------
create or replace function public._fn_restore_pk_columns(p_table_name text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case p_table_name
    when 'provinces' then array['code']
    when 'query_sources' then array['code']
    when 'units' then array['code']
    when 'role_permissions' then array['permission_key']
    when 'unit_conversions' then array['from_unit','to_unit']
    when 'user_roles' then array['user_id','role_id']
    when 'roles' then array['id']
    when 'company' then array['id']
    when 'warehouses' then array['id']
    when 'chart_of_accounts' then array['id']
    when 'expense_heads' then array['id']
    when 'bank_accounts' then array['id']
    when 'petty_cash_funds' then array['id']
    when 'vehicles' then array['id']
    when 'items' then array['id']
    when 'item_alt_units' then array['id']
    when 'product_templates' then array['id']
    when 'product_template_lines' then array['id']
    when 'parties' then array['id']
    when 'party_contacts' then array['id']
    when 'queries' then array['id']
    when 'quotations' then array['id']
    when 'quotation_revisions' then array['id']
    when 'quotation_lines' then array['id']
    when 'sales_orders' then array['id']
    when 'sales_order_lines' then array['id']
    when 'sales_order_revisions' then array['id']
    when 'purchase_orders' then array['id']
    when 'purchase_order_lines' then array['id']
    when 'grns' then array['id']
    when 'grn_lines' then array['id']
    when 'jobs' then array['id']
    when 'job_material_requirements' then array['id']
    when 'job_cost_ledger' then array['id']
    when 'stock_reservations' then array['id']
    when 'stock_ledger' then array['id']
    when 'stock_adjustments' then array['id']
    when 'stock_transfers' then array['id']
    when 'stock_transfer_lines' then array['id']
    when 'delivery_challans' then array['id']
    when 'delivery_challan_lines' then array['id']
    when 'invoices' then array['id']
    when 'invoice_lines' then array['id']
    when 'supplier_bills' then array['id']
    when 'supplier_bill_lines' then array['id']
    when 'sales_returns' then array['id']
    when 'sales_return_lines' then array['id']
    when 'purchase_returns' then array['id']
    when 'purchase_return_lines' then array['id']
    when 'payments' then array['id']
    when 'payment_allocations' then array['id']
    when 'contra_transfers' then array['id']
    when 'expenses' then array['id']
    when 'journal_entries' then array['id']
    when 'journal_lines' then array['id']
    when 'numbering_sequences' then array['id']
    when 'daily_snapshots' then array['id']
    when 'tasks' then array['id']
    when 'activity_timeline' then array['id']
    when 'attachments' then array['id']
    when 'audit_log' then array['id']
    when 'import_batches' then array['id']
    when 'login_sessions' then array['id']
    when 'profiles' then array['id']
    when 'hr_settings' then array['id']
    when 'hr_policy_groups' then array['id']
    when 'hr_policy_versions' then array['id']
    when 'hr_employees' then array['id']
    when 'hr_employee_terms' then array['id']
    when 'hr_holidays' then array['id']
    when 'hr_leave_types' then array['id']
    when 'hr_attendance' then array['id']
    when 'hr_advances' then array['id']
    when 'hr_salary_sheets' then array['id']
    when 'hr_salary_lines' then array['id']
    when 'hr_salary_days' then array['id']
    when 'hr_advance_recoveries' then array['id']
    else null
  end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Attendance register
-- ---------------------------------------------------------------------------
-- One row per employee employed in the month: a status code per day
-- ('' before joining / after leaving) and the month's totals.
create or replace function public.fn_hr_register(p_month date)
returns table (
  employee_id uuid,
  codes text[],
  present numeric,
  half_days int,
  absent numeric,
  leave numeric,
  not_entered int,
  lates int,
  worked_minutes int,
  ot_minutes int
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
begin
  if not public.fn_hr_can_read() then
    raise exception 'Not allowed.';
  end if;
  return query
  with r as (select * from public.fn_hr_day_results(v_from, v_to)),
  days as (select g::date as d from generate_series(v_from, v_to, interval '1 day') g)
  select
    e.id,
    array(
      select coalesce(case x.calc ->> 'status'
                        when 'P' then 'P' when 'HD' then '½' when 'A' then 'A' when 'L' then 'L'
                        when 'HL' then '½L' when 'NE' then '?' when 'W' then 'W' when 'OFF' then '-' when 'HOL' then 'H' end, '')
      from days left join r x on x.employee_id = e.id and x.work_date = days.d
      order by days.d),
    coalesce(sum((r.calc ->> 'work_value')::numeric) filter (where r.day_kind = 'work'), 0),
    (count(*) filter (where r.calc ->> 'status' = 'HD'))::int,
    coalesce(sum(greatest(1 - (r.calc ->> 'work_value')::numeric - (r.calc ->> 'leave_value')::numeric, 0)) filter (where r.day_kind = 'work'), 0),
    coalesce(sum((r.calc ->> 'leave_value')::numeric), 0),
    (count(*) filter (where r.calc ->> 'status' = 'NE'))::int,
    (count(*) filter (where (r.calc ->> 'late_counted')::boolean))::int,
    coalesce(sum((r.calc ->> 'net')::int), 0)::int,
    coalesce(sum((r.calc ->> 'ot')::int + (r.calc ->> 'offday_ot')::int), 0)::int
  from public.hr_employees e
  join r on r.employee_id = e.id
  group by e.id;
end;
$$;

revoke execute on function public.fn_hr_register(date) from public, anon;
grant execute on function public.fn_hr_register(date) to authenticated;
