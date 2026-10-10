-- Three user-typed external-reference fields, structurally identical to
-- payments.reference_no (pure memo, doesn't drive any accounting math):
-- Sales Order's Client PO Number, Service Job's Client's DC No., and
-- Supplier Bill's Supplier Bill Ref. Each becomes freely editable by the
-- role that already manages that document.

-- service_jobs already has a general p_update RLS policy (Owner/Sales/
-- Store), so it can go through the existing generic Smart Merge RPC --
-- just extend the allowlist.
create or replace function public._fn_smart_merge_editable_columns(p_table_name text)
 returns text[]
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case p_table_name
    when 'company' then array['legal_name', 'ntn', 'strn', 'address', 'province', 'phone', 'email', 'default_sales_tax_pct']
    when 'parties' then array['credit_limit', 'credit_days']
    when 'warehouses' then array['name', 'address']
    when 'vehicles' then array['assigned_user_id', 'assignment_date', 'status']
    when 'items' then array['item_code', 'description', 'category', 'spec', 'base_unit', 'hs_code', 'tax_category', 'is_stocked', 'standard_cost']
    when 'service_jobs' then array['customer_dc_no']
    else null
  end;
$function$;

-- sales_orders and supplier_bills are deliberately append-only workflow
-- documents with NO general RLS update policy at all (every other field
-- is only ever moved through its own dedicated state-machine RPC) --
-- adding a broad UPDATE policy just to reach Smart Merge would open every
-- other column on the row to direct REST writes too. A narrow, single-
-- column RPC keeps the same "SECURITY DEFINER checks its own permission"
-- shape as the rest of this app instead.
create or replace function public.fn_update_sales_order_po_number(p_id uuid, p_po_number text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not (public.is_owner() or public.has_role('sales')) then
    raise exception 'Only Owner or Sales can edit the Client PO Number.';
  end if;
  update public.sales_orders
    set client_po_number = nullif(trim(p_po_number), ''), row_version = coalesce(row_version,0) + 1
    where id = p_id;
  if not found then
    raise exception 'Sales Order not found.';
  end if;
end;
$function$;

create or replace function public.fn_update_supplier_bill_ref(p_id uuid, p_ref text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can edit the Supplier Bill Ref.';
  end if;
  update public.supplier_bills
    set supplier_bill_ref = nullif(trim(p_ref), ''), row_version = coalesce(row_version,0) + 1
    where id = p_id;
  if not found then
    raise exception 'Supplier Bill not found.';
  end if;
end;
$function$;
