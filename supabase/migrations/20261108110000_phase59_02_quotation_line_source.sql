-- Phase 59.02: a quotation line remembers the line of the earlier revision it continues.
--
-- Lines turned into a Sales Order / Service Job by a client PO are marked on the line of the
-- revision that was current at the time. A new revision creates new line rows, so without this link
-- those lines would look "not yet ordered" again on the PO screen. A revision now sends each kept
-- line's previous id (source_line_id); _fn_insert_quotation_lines stores it (only when that line
-- exists, otherwise null). Nothing existing changes; the column is nullable.
alter table public.quotation_lines
  add column if not exists source_line_id uuid references public.quotation_lines(id) on delete set null;

create or replace function public._fn_insert_quotation_lines(p_revision_id uuid, p_lines jsonb)
returns table(subtotal numeric, tax_total numeric, grand_total numeric)
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_line jsonb;
  v_idx int := 0;
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_type text;
  v_source uuid;
begin
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Quotation must have at least one line.';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_type := nullif(btrim(coalesce(v_line->>'line_type', '')), '');
    if v_type is not null and v_type not in ('material', 'fabrication', 'service') then
      v_type := null;
    end if;
    -- the line of the earlier revision this one continues (kept only when that line exists)
    v_source := null;
    begin
      v_source := nullif(v_line->>'source_line_id', '')::uuid;
    exception when others then
      v_source := null;
    end;
    if v_source is not null and not exists (select 1 from public.quotation_lines where id = v_source) then
      v_source := null;
    end if;
    insert into public.quotation_lines (revision_id, item_id, description, qty, unit, rate, tax_pct, sort_order, line_type, source_line_id)
    values (
      p_revision_id,
      nullif(v_line->>'item_id','')::uuid,
      v_line->>'description',
      (v_line->>'qty')::numeric,
      nullif(v_line->>'unit',''),
      (v_line->>'rate')::numeric,
      coalesce((v_line->>'tax_pct')::numeric, 0),
      v_idx,
      v_type,
      v_source
    );
    v_subtotal := v_subtotal + round((v_line->>'qty')::numeric * (v_line->>'rate')::numeric, 2);
    v_tax := v_tax + round((v_line->>'qty')::numeric * (v_line->>'rate')::numeric * coalesce((v_line->>'tax_pct')::numeric, 0) / 100, 2);
    v_idx := v_idx + 1;
  end loop;

  return query select v_subtotal, v_tax, v_subtotal + v_tax;
end;
$fn$;
