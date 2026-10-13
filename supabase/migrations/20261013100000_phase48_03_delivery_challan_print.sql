-- Phase 48.03: Delivery Challan in the HiTech pre-printed form layout.
--
-- * delivery_challans.ref_no: the "Ref. No." of the form. Filled from the
--   client's PO number when the challan is made, editable afterwards.
-- * delivery_challan_lines.remarks: the "Remarks" column of the form.
-- * company.print_tagline: the diagonal watermark line ("Quality & Safety is
--   our Priority").
-- * fn_set_dc_print_details: sets Ref. No. and the per-line remarks (the
--   challan lines have no UPDATE policy, so this is the one controlled way,
--   used right after a challan is created and from the challan page).

alter table public.delivery_challans add column if not exists ref_no text;
alter table public.delivery_challan_lines add column if not exists remarks text;
alter table public.company add column if not exists print_tagline text;

create or replace function public.fn_set_dc_print_details(
  p_dc_id uuid,
  p_ref_no text,
  p_line_remarks jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_item jsonb;
begin
  if not (public.is_owner() or public.has_role('dispatch')) then
    raise exception 'Only the Owner or Dispatch can edit Delivery Challan print details.';
  end if;

  select status into v_status from public.delivery_challans where id = p_dc_id for update;
  if v_status is null then
    raise exception 'Delivery Challan not found.';
  end if;
  if v_status = 'Cancelled' then
    raise exception 'A cancelled Delivery Challan cannot be edited.';
  end if;

  update public.delivery_challans set ref_no = nullif(btrim(coalesce(p_ref_no, '')), '') where id = p_dc_id;

  if p_line_remarks is not null and jsonb_typeof(p_line_remarks) = 'array' then
    for v_item in select * from jsonb_array_elements(p_line_remarks) loop
      update public.delivery_challan_lines
      set remarks = nullif(btrim(coalesce(v_item ->> 'remarks', '')), '')
      where dc_id = p_dc_id and sales_order_line_id = (v_item ->> 'sales_order_line_id')::uuid;
    end loop;
  end if;
end;
$$;

revoke execute on function public.fn_set_dc_print_details(uuid, text, jsonb) from public, anon;
grant execute on function public.fn_set_dc_print_details(uuid, text, jsonb) to authenticated;

update public.company
set print_tagline = coalesce(print_tagline, 'Quality & Safety is our Priority')
where id = '00000000-0000-0000-0000-000000000001';
