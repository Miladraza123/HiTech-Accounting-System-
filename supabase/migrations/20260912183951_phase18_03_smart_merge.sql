-- ============================================================
-- Phase 18 Part B — Smart Merge (field-level 3-way conflict
-- resolution), replacing the old "reject the whole update if
-- anything changed" pattern.
--
-- Scope: this app's business documents (queries -> quotations ->
-- sales orders -> jobs -> delivery -> invoices -> payments) are
-- append-only workflow documents — created once, then moved
-- through fixed state-machine actions (cancel/amend-as-new-
-- revision/record-pod/allocate/etc.), each of which already
-- targets its own distinct, well-defined columns via its own
-- dedicated RPC. There is no free-form "edit this record's own
-- fields" UI for those documents to begin with, so there is
-- nothing for a 3-way field merge to protect there.
--
-- The two places in this app that ARE genuine free-form,
-- edit-anytime, multi-field forms on an existing row — where two
-- people really can open the same record and change different
-- fields of it at the same time — are:
--   - Company Profile (singleton `company` row)
--   - Party (client/supplier) credit terms
-- Smart Merge is wired into exactly those two, through a single
-- generic, reusable engine (`fn_smart_merge_update`) driven by a
-- per-table editable-column allowlist, so any future free-edit
-- form can opt in later by adding one line to that allowlist.
-- ============================================================

-- Per-table allowlist of columns Smart Merge is allowed to touch.
-- Same security-boundary pattern as _fn_restore_pk_columns: a table
-- or column not listed here can never be written through this path,
-- no matter what a client sends.
create or replace function public._fn_smart_merge_editable_columns(p_table_name text)
returns text[]
language sql
immutable
set search_path to 'public'
as $function$
  select case p_table_name
    when 'company' then array['legal_name','ntn','strn','address','province','phone','email','default_sales_tax_pct']
    when 'parties' then array['credit_limit','credit_days']
    else null
  end;
$function$;

-- Type-aware equality for the text representations jsonb ->> gives us:
-- '18' and '18.00' are the same *value* even though they're different
-- strings, so a numeric column never reports a false conflict just
-- because Postgres's numeric(p,s) text formatting differs from what a
-- browser last displayed.
create or replace function public._fn_smart_merge_values_equal(a text, b text)
returns boolean
language plpgsql
immutable
as $function$
declare
  na numeric;
  nb numeric;
begin
  if a is null and b is null then return true; end if;
  if a is null or b is null then return false; end if;
  if a = b then return true; end if;
  begin
    na := a::numeric;
    nb := b::numeric;
    return na = nb;
  exception when others then
    return false;
  end;
end;
$function$;

-- Field-level 3-way merge.
--   p_base    — the row's values as this client last loaded them
--               (only needs to include the fields it's changing).
--   p_changes — the new values this client wants to write (only the
--               fields it's actually changing).
-- For every field in p_changes:
--   - current == new           -> already matches, nothing to do.
--   - current == base          -> nobody else touched it since I
--                                  loaded it, apply my value.
--   - otherwise                -> someone else changed this exact
--                                  field to a different value than
--                                  mine since I loaded it: a genuine
--                                  conflict. That field is left
--                                  untouched and reported back; every
--                                  OTHER, non-conflicting field I
--                                  changed is still applied in the
--                                  same statement. This is the "smart"
--                                  part — one colliding field no
--                                  longer blocks the rest of the edit.
-- Runs with the CALLER's own privileges (not security definer) so the
-- table's normal RLS UPDATE policy still decides who may write —
-- Smart Merge is a conflict-resolution layer on top of the existing
-- permission model, not a way around it.
create or replace function public.fn_smart_merge_update(
  p_table_name text,
  p_row_id uuid,
  p_base jsonb,
  p_changes jsonb
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_allowed text[];
  v_key text;
  v_current jsonb;
  v_current_val text;
  v_base_val text;
  v_new_val text;
  v_conflicts jsonb := '[]'::jsonb;
  v_applied jsonb := '{}'::jsonb;
  v_set_clauses text[] := array[]::text[];
  v_sql text;
  v_row_count integer;
  v_has_row_version boolean;
begin
  v_allowed := public._fn_smart_merge_editable_columns(p_table_name);
  if v_allowed is null then
    raise exception 'fn_smart_merge_update: table % is not enabled for Smart Merge', p_table_name;
  end if;

  execute format('select to_jsonb(t) from %I t where id = $1', p_table_name)
    into v_current
    using p_row_id;
  if v_current is null then
    raise exception 'fn_smart_merge_update: row % not found in %', p_row_id, p_table_name;
  end if;

  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any(v_allowed)) then
      raise exception 'fn_smart_merge_update: column % is not editable on %', v_key, p_table_name;
    end if;

    v_current_val := v_current ->> v_key;
    v_base_val := p_base ->> v_key;
    v_new_val := p_changes ->> v_key;

    if public._fn_smart_merge_values_equal(v_current_val, v_new_val) then
      continue;
    elsif public._fn_smart_merge_values_equal(v_current_val, v_base_val) then
      v_set_clauses := v_set_clauses || format('%I = %L', v_key, v_new_val);
      v_applied := v_applied || jsonb_build_object(v_key, p_changes -> v_key);
    else
      v_conflicts := v_conflicts || jsonb_build_object(
        'field', v_key,
        'base_value', p_base -> v_key,
        'server_value', v_current -> v_key,
        'my_value', p_changes -> v_key
      );
    end if;
  end loop;

  if array_length(v_set_clauses, 1) > 0 then
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = p_table_name and column_name = 'row_version'
    ) into v_has_row_version;
    if v_has_row_version then
      v_set_clauses := v_set_clauses || 'row_version = coalesce(row_version, 0) + 1';
    end if;

    v_sql := format('update %I set %s where id = $1', p_table_name, array_to_string(v_set_clauses, ', '));
    execute v_sql using p_row_id;
    get diagnostics v_row_count = row_count;
    if v_row_count = 0 then
      raise exception 'fn_smart_merge_update: update on % blocked (not found or not permitted)', p_table_name;
    end if;
  end if;

  return jsonb_build_object('applied', v_applied, 'conflicts', v_conflicts);
end;
$function$;
