-- Bug found while testing phase18_03: appending an untyped string literal
-- to a text[] via `||` is ambiguous in Postgres (it tries to parse the
-- literal as an array literal first, raising "malformed array literal")
-- -- must cast explicitly to text on both append sites.
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
      v_set_clauses := v_set_clauses || format('%I = %L', v_key, v_new_val)::text;
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
      v_set_clauses := v_set_clauses || 'row_version = coalesce(row_version, 0) + 1'::text;
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
