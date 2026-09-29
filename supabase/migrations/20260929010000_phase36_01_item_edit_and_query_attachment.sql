-- Phase 36 — user-requested fixes round:
--  1. Items were create-only (only reorder_level/active-toggle/alt-units
--     were ever editable after creation) — widen the Smart Merge allowlist
--     to cover every remaining Item Master field, exactly the same
--     mechanical extension every prior phase used (Company/Party/
--     Warehouse/Vehicle). RLS already permits Owner/Store/Production to
--     write `items` (see phase0_06_rls_policies.sql's p_write policy on
--     items) — Smart Merge runs as the caller, not security definer, so
--     that existing policy is what actually gates this, unchanged.
--  2. Query creation gets an optional first-document attachment. Reuses
--     the existing generic `attachments` table/storage bucket — no new
--     schema needed, just a client-generated id so the file can be
--     uploaded to Storage under the query's real, final id in the same
--     request that creates the row (see createQueryAction).

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
    else null
  end;
$function$;
