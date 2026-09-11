-- Atomic document numbering. Pakistan fiscal year: 1 July – 30 June.
create or replace function public.fn_get_next_number(p_doc_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.numbering_sequences%rowtype;
  v_current_fy int;
  v_number text;
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

  v_number := v_row.prefix || to_char(v_current_fy, 'FM0000') || to_char((v_current_fy+1)%100, 'FM00') || '-' ||
              lpad(v_row.current_value::text, v_row.padding, '0');
  return v_number;
end;
$$;

grant execute on function public.fn_get_next_number(text) to authenticated;

-- Login/logout session trail (separate from the field-change audit_log)
create or replace function public.fn_log_login(p_ip text default null, p_device text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.login_sessions (user_id, ip_address, device_info)
  values (auth.uid(), p_ip, p_device)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.fn_log_logout(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.login_sessions
    set logout_at = now()
    where id = p_session_id and user_id = auth.uid() and logout_at is null;
end;
$$;

grant execute on function public.fn_log_login(text, text) to authenticated;
grant execute on function public.fn_log_logout(uuid) to authenticated;
grant execute on function public.fn_post_journal_entry(date, text, text, uuid, jsonb) to authenticated;
