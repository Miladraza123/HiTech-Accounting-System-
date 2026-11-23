-- Phase 68.01: new GST Invoices and Service Invoices get a plain number (963, 796, ...).
--
-- * padding = 1 now means "no zero padding" (a plain number); every other padding behaves exactly as before
--   (lpad also cuts a longer number down to the padding, which is why padding = 1 could not simply be set).
-- * INV: no prefix, no financial-year part, never reset; the counter is set to 962 because 953-962 were already
--   taken by Posted invoices (the counter had fallen behind after numbers were reused by hand), so the next is 963.
-- * SVI (Service Invoice): no prefix; the counter stays at 795, so the next is 796.
-- Existing invoices keep their numbers (INV-202627-0952 ..., SRB 795). Other document series are untouched.

create or replace function public.fn_get_next_number(p_doc_type text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_row public.numbering_sequences%rowtype;
  v_current_fy int;
  v_number text;
  v_guard int := 0;
begin
  select * into v_row from public.numbering_sequences where doc_type = p_doc_type for update;
  if not found then
    raise exception 'Unknown document type: %', p_doc_type;
  end if;

  v_current_fy := case when extract(month from current_date) >= 7
                       then extract(year from current_date)::int
                       else extract(year from current_date)::int - 1
                  end;

  if v_row.fy_reset and (v_row.last_reset_fy is distinct from v_current_fy) then
    update public.numbering_sequences
      set current_value = 1, last_reset_fy = v_current_fy, updated_at = now()
      where doc_type = p_doc_type
      returning current_value into v_row.current_value;
  else
    update public.numbering_sequences
      set current_value = current_value + 1, updated_at = now()
      where doc_type = p_doc_type
      returning current_value into v_row.current_value;
  end if;

  loop
    if v_row.include_fy then
      v_number := v_row.prefix || to_char(v_current_fy, 'FM0000') || to_char((v_current_fy+1)%100, 'FM00') || '-' ||
                  case when v_row.padding > 1 then lpad(v_row.current_value::text, v_row.padding, '0') else v_row.current_value::text end;
    else
      v_number := v_row.prefix ||
                  case when v_row.padding > 1 then lpad(v_row.current_value::text, v_row.padding, '0') else v_row.current_value::text end;
    end if;
    exit when not public._fn_number_in_use(p_doc_type, v_number) or v_guard >= 5000;
    v_guard := v_guard + 1;
    update public.numbering_sequences
      set current_value = current_value + 1, updated_at = now()
      where doc_type = p_doc_type
      returning current_value into v_row.current_value;
  end loop;
  return v_number;
end;
$fn$;

create or replace function public.fn_peek_next_number(p_doc_type text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_row public.numbering_sequences%rowtype;
  v_current_fy int;
  v_next_value int;
  v_number text;
  v_guard int := 0;
begin
  select * into v_row from public.numbering_sequences where doc_type = p_doc_type;
  if not found then
    raise exception 'Unknown document type: %', p_doc_type;
  end if;

  v_current_fy := case when extract(month from current_date) >= 7
                       then extract(year from current_date)::int
                       else extract(year from current_date)::int - 1
                  end;

  if v_row.fy_reset and (v_row.last_reset_fy is distinct from v_current_fy) then
    v_next_value := 1;
  else
    v_next_value := v_row.current_value + 1;
  end if;

  loop
    if v_row.include_fy then
      v_number := v_row.prefix || to_char(v_current_fy, 'FM0000') || to_char((v_current_fy+1)%100, 'FM00') || '-' ||
                  case when v_row.padding > 1 then lpad(v_next_value::text, v_row.padding, '0') else v_next_value::text end;
    else
      v_number := v_row.prefix ||
                  case when v_row.padding > 1 then lpad(v_next_value::text, v_row.padding, '0') else v_next_value::text end;
    end if;
    exit when not public._fn_number_in_use(p_doc_type, v_number) or v_guard >= 5000;
    v_guard := v_guard + 1;
    v_next_value := v_next_value + 1;
  end loop;
  return v_number;
end;
$fn$;

update public.numbering_sequences
  set prefix = '', include_fy = false, fy_reset = false, padding = 1, current_value = 962, updated_at = now()
  where doc_type = 'INV' and prefix = 'INV-' and current_value = 952;
update public.numbering_sequences
  set prefix = '', padding = 1, updated_at = now()
  where doc_type = 'SVI' and prefix = 'SRB ' and current_value = 795;
