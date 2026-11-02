-- Phase 53: GST invoice line descriptions are editable.
--
-- 1. When an Invoice is created the user may now word each line's description
--    (it used to be copied from the Sales Order line, with no way to change it).
--    A blank description still falls back to the Sales Order line's own text.
--    The Sales Order itself is untouched.
-- 2. After posting, only the description of a line can be changed
--    (fn_update_invoice_line_description) -- qty, rate, tax and every amount
--    stay locked because the ledger is built from them. Each change is
--    recorded (who, when, old -> new) in activity_timeline (event_type 'system', note
--    starting 'Line description changed:' -- the table's check constraint only allows a fixed set of types), shown on the
--    invoice page and in the Activity Log.

-- ---- 1. creation: take an optional description per line ----------------------
do $patch$
declare
  v_name text;
  v_def text;
  v_new text;
begin
  foreach v_name in array array['fn_create_invoice', 'fn_create_invoice_idempotent'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p where p.proname = v_name and p.pronamespace = 'public'::regnamespace;
    if v_def is null then
      raise exception '% not found', v_name;
    end if;
    if v_def like '%nullif(left(btrim(v_line->>''description''), 2000), '''')%' then
      continue; -- already patched
    end if;
    v_new := replace(v_def,
      'v_sol.item_id, v_sol.description, v_qty',
      'v_sol.item_id, coalesce(nullif(left(btrim(v_line->>''description''), 2000), ''''), v_sol.description), v_qty');
    if v_new = v_def then
      raise exception '% patch did not apply', v_name;
    end if;
    execute v_new;
  end loop;
end
$patch$;

-- ---- 2. after posting: description-only edit with a history entry --------------
create or replace function public.fn_update_invoice_line_description(p_invoice_line_id uuid, p_description text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.invoice_lines;
  v_status text;
  v_invoice_no text;
  v_new text := left(btrim(coalesce(p_description, '')), 2000);
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can edit an Invoice description.';
  end if;
  if v_new = '' then
    raise exception 'The description cannot be empty.';
  end if;

  select * into v_line from public.invoice_lines where id = p_invoice_line_id for update;
  if v_line.id is null then
    raise exception 'Invoice line not found.';
  end if;
  select status, invoice_no into v_status, v_invoice_no from public.invoices where id = v_line.invoice_id for update;
  if v_status is distinct from 'Posted' then
    raise exception 'Only a Posted Invoice can be edited (this one is %).', coalesce(v_status, 'unknown');
  end if;
  if v_new = v_line.description then
    raise exception 'Nothing was changed.';
  end if;

  update public.invoice_lines set description = v_new where id = v_line.id;

  insert into public.activity_timeline (owner_table, owner_id, event_type, note, actor_id)
  values ('invoices', v_line.invoice_id, 'system',
          format('Line description changed: "%s" -> "%s"', left(v_line.description, 300), left(v_new, 300)),
          auth.uid());
end;
$$;

revoke all on function public.fn_update_invoice_line_description(uuid, text) from public, anon;
grant execute on function public.fn_update_invoice_line_description(uuid, text) to authenticated;

-- ---- Activity Log: show these edits (fn_activity_feed patched in place) ----------
do $patch$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.proname = 'fn_activity_feed' and p.pronamespace = 'public'::regnamespace;
  if v_def is null then
    raise exception 'fn_activity_feed not found';
  end if;
  if v_def like '%invoice_desc_events%' then
    -- already patched; only upgrade the filter if an earlier draft of this patch used another event type
    if v_def like '%description_edited%' then
      execute replace(v_def, 't.event_type = ''description_edited''', 't.event_type = ''system'' and t.note like ''Line description changed:%''');
    end if;
    return;
  end if;

  -- Whitespace-insensitive: a function saved through an SQL editor may have different indentation.
  v_new := regexp_replace(v_def,
    'events as \(\s+select \* from logins',
    $cte$invoice_desc_events as (
    select t.at as at,
           coalesce(p.full_name, 'Unknown user') as actor_name,
           'update' as event_type,
           'Edited Invoice description' as summary,
           i.invoice_no as doc_no,
           left(t.note, 400) as detail,
           null::text as ip_address,
           '/invoices/' || t.owner_id as link_href
    from public.activity_timeline t
    join public.invoices i on i.id = t.owner_id
    left join public.profiles p on p.id = t.actor_id
    where t.owner_table = 'invoices' and t.event_type = 'system' and t.note like 'Line description changed:%'
  ),
  events as (
    select * from logins$cte$);
  if v_new = v_def then
    raise exception 'fn_activity_feed patch (CTE) did not apply';
  end if;
  v_def := v_new;
  v_new := regexp_replace(v_def, 'union all select \* from business_events', E'union all select * from business_events\n    union all select * from invoice_desc_events');
  if v_new = v_def then
    raise exception 'fn_activity_feed patch (union) did not apply';
  end if;
  execute v_new;
end
$patch$;
