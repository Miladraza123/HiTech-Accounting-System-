-- Phase 65.01: editable item Description on a Delivery Challan (print only).
--
-- delivery_challan_lines.description stays exactly as it was copied from the Sales Order line.
-- A new nullable column holds the wording to PRINT; null means "print the original".
-- Nothing else (Sales Order, stock, accounts, Invoices, quantities) reads or changes.
alter table public.delivery_challan_lines add column if not exists print_description text;

-- Same signature as before. Each p_line_remarks item may now also carry "description"
-- (only when the key is present: older callers that send just remarks leave it untouched).
create or replace function public.fn_set_dc_print_details(p_dc_id uuid, p_ref_no text, p_line_remarks jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_status text;
  v_item jsonb;
  v_desc text;
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

      if v_item ? 'description' then
        v_desc := btrim(coalesce(v_item ->> 'description', ''));
        if char_length(v_desc) > 2000 then
          raise exception 'A description is too long.';
        end if;
        update public.delivery_challan_lines
        set print_description = case when v_desc = '' or v_desc = btrim(description) then null else v_desc end
        where dc_id = p_dc_id and sales_order_line_id = (v_item ->> 'sales_order_line_id')::uuid;
      end if;
    end loop;
  end if;
end;
$fn$;
