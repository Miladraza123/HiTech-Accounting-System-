-- Phase 58.01: the next invoice number never lands on a number a Posted invoice already holds.
--
-- Cancelled invoice numbers can be picked again for a new invoice (phase 49). A number picked by
-- hand does not move the counter, so the counter stayed behind: after INV-...-0952 was cancelled and
-- re-issued, the next automatic number was 0952 again and every new invoice failed with
-- "Invoice number ... is already in use.".
--
-- fn_get_next_number / fn_peek_next_number now skip any number that a Posted invoice holds (the
-- counter moves past it). Other document types behave exactly as before.

create or replace function public._fn_number_in_use(p_doc_type text, p_number text)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select p_doc_type in ('INV', 'SRB')
     and exists (select 1 from public.invoices where invoice_no = p_number and status = 'Posted');
$fn$;
revoke all on function public._fn_number_in_use(text, text) from public, anon, authenticated;

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
                  lpad(v_row.current_value::text, v_row.padding, '0');
    else
      v_number := v_row.prefix || lpad(v_row.current_value::text, v_row.padding, '0');
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
                  lpad(v_next_value::text, v_row.padding, '0');
    else
      v_number := v_row.prefix || lpad(v_next_value::text, v_row.padding, '0');
    end if;
    exit when not public._fn_number_in_use(p_doc_type, v_number) or v_guard >= 5000;
    v_guard := v_guard + 1;
    v_next_value := v_next_value + 1;
  end loop;
  return v_number;
end;
$fn$;
