-- Phase 48.01: Quotation and Service Invoice print layout (Tri-Pack style).
--
-- * Company: short code (HTE), signatory name, the FBR note printed on service
--   invoices, and the two letterhead banner images (header, footer).
-- * Party: short code (TPFL), used in the quotation reference HTE/TPFL/<serial>,
--   and two "required on documents" switches (Attn on a quotation, client PO
--   number on a service invoice).
-- * Quotation: Attn and Subject. Service invoice: client PO number.
-- * Numbering: a sequence can leave the financial year out of the number. The
--   service invoice becomes "SRB 001", "SRB 002", ...; quotations no longer
--   restart every financial year (the reference uses the running serial).

alter table public.company
  add column if not exists short_code text,
  add column if not exists signatory_name text,
  add column if not exists service_invoice_note text,
  add column if not exists letterhead_header_path text,
  add column if not exists letterhead_footer_path text;

alter table public.parties
  add column if not exists short_code text,
  add column if not exists require_quotation_attn boolean not null default false,
  add column if not exists require_invoice_po boolean not null default false;

alter table public.quotations
  add column if not exists attn text,
  add column if not exists subject text;

alter table public.service_invoices
  add column if not exists client_po_no text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_short_code_format') then
    alter table public.company add constraint company_short_code_format
      check (short_code is null or short_code ~ '^[A-Z0-9]{2,10}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'parties_short_code_format') then
    alter table public.parties add constraint parties_short_code_format
      check (short_code is null or short_code ~ '^[A-Z0-9]{2,10}$');
  end if;
end $$;

alter table public.numbering_sequences
  add column if not exists include_fy boolean not null default true;

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

  if v_row.include_fy then
    v_number := v_row.prefix || to_char(v_current_fy, 'FM0000') || to_char((v_current_fy+1)%100, 'FM00') || '-' ||
                lpad(v_row.current_value::text, v_row.padding, '0');
  else
    v_number := v_row.prefix || lpad(v_row.current_value::text, v_row.padding, '0');
  end if;
  return v_number;
end;
$$;

-- Quotations: one running serial. Service invoices: SRB 001, SRB 002, ...
update public.numbering_sequences set fy_reset = false where doc_type = 'QTN';
update public.numbering_sequences
  set prefix = 'SRB ', padding = 3, fy_reset = false, include_fy = false, last_reset_fy = null
  where doc_type = 'SVI' and current_value = 0;

-- Defaults for the existing company row.
update public.company
set short_code = coalesce(short_code, 'HTE'),
    signatory_name = coalesce(signatory_name, 'MUHAMMAD ABBAS'),
    service_invoice_note = coalesce(
      service_invoice_note,
      'Note: According to FBR Tax Laws please deduct 4% Income Tax U/s 153 (1) (b) (Engineering Services) and deposit in Government Treasury. After that please provide income tax challans.'
    );
