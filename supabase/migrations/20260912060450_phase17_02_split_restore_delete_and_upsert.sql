-- ============================================================
-- Splits the single fn_admin_restore_table into two functions, because
-- a "replace" restore needs DELETE and INSERT to run in opposite table
-- orders to never trip a foreign key:
--   - Orphan deletes must go children-before-parents (a child row
--     referencing a soon-to-be-deleted parent would block that delete
--     otherwise).
--   - Upserts must go parents-before-children (a child row can't be
--     inserted before the parent it references exists).
-- The Restore feature calls fn_admin_restore_delete_orphans in reverse
-- TABLE_ORDER first, then fn_admin_restore_upsert in forward
-- TABLE_ORDER — see src/app/actions/backupRestore.ts.
--
-- RECOVERED FROM THE LIVE DATABASE, for the same reason as
-- phase17_01: the migration was applied but its file was missing from
-- supabase/migrations. Restored verbatim from
-- supabase_migrations.schema_migrations; the Roman-Urdu exception
-- messages are the original text, translated by later migrations.
-- ============================================================

drop function if exists public.fn_admin_restore_table(text, text, jsonb);

create or replace function public.fn_admin_restore_delete_orphans(p_table_name text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pk_cols text[] := public._fn_restore_pk_columns(p_table_name);
  v_match_expr text;
  v_before int;
  v_after int;
begin
  if not public.is_owner() then
    raise exception 'Sirf Owner restore kar sakte hain.';
  end if;
  if v_pk_cols is null then
    raise exception 'Table % restore ke liye allowed nahi hai.', p_table_name;
  end if;

  select string_agg(format('t.%1$I = r.%1$I', c), ' and ') into v_match_expr from unnest(v_pk_cols) c;

  execute format('select count(*) from public.%I', p_table_name) into v_before;
  execute format(
    'delete from public.%1$I t where not exists (select 1 from jsonb_populate_recordset(null::public.%1$I, $1) r where %2$s)',
    p_table_name, v_match_expr
  ) using p_rows;
  execute format('select count(*) from public.%I', p_table_name) into v_after;

  return v_before - v_after; -- rows deleted
end;
$function$;

create or replace function public.fn_admin_restore_upsert(p_table_name text, p_mode text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pk_cols text[] := public._fn_restore_pk_columns(p_table_name);
  v_conflict_target text;
  v_update_set text;
  v_before_count int;
  v_after_count int;
  v_incoming int;
begin
  if not public.is_owner() then
    raise exception 'Sirf Owner restore kar sakte hain.';
  end if;
  if v_pk_cols is null then
    raise exception 'Table % restore ke liye allowed nahi hai.', p_table_name;
  end if;
  if p_mode not in ('merge', 'replace') then
    raise exception 'Mode "merge" ya "replace" hona chahiye.';
  end if;

  select string_agg(format('%I', c), ', ') into v_conflict_target from unnest(v_pk_cols) c;

  execute format('select count(*) from jsonb_populate_recordset(null::public.%I, $1)', p_table_name)
    using p_rows into v_incoming;
  execute format('select count(*) from public.%I', p_table_name) into v_before_count;

  if p_mode = 'replace' then
    select string_agg(format('%1$I = excluded.%1$I', column_name), ', ') into v_update_set
    from information_schema.columns
    where table_schema = 'public' and table_name = p_table_name and not (column_name = any(v_pk_cols));

    if v_update_set is null then
      execute format(
        'insert into public.%1$I select * from jsonb_populate_recordset(null::public.%1$I, $1) on conflict (%2$s) do nothing',
        p_table_name, v_conflict_target
      ) using p_rows;
    else
      execute format(
        'insert into public.%1$I select * from jsonb_populate_recordset(null::public.%1$I, $1) on conflict (%2$s) do update set %3$s',
        p_table_name, v_conflict_target, v_update_set
      ) using p_rows;
    end if;
  else
    execute format(
      'insert into public.%1$I select * from jsonb_populate_recordset(null::public.%1$I, $1) on conflict (%2$s) do nothing',
      p_table_name, v_conflict_target
    ) using p_rows;
  end if;

  execute format('select count(*) from public.%I', p_table_name) into v_after_count;

  return jsonb_build_object(
    'table', p_table_name, 'mode', p_mode, 'incoming', v_incoming,
    'before_count', v_before_count, 'after_count', v_after_count
  );
end;
$function$;

revoke all on function public.fn_admin_restore_delete_orphans(text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_admin_restore_delete_orphans(text, jsonb) to authenticated;
revoke all on function public.fn_admin_restore_upsert(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_admin_restore_upsert(text, text, jsonb) to authenticated;
