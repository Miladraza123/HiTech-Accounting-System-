-- Phase 55: the GST Sales Tax Invoice prints in HiTech's own layout.
--
-- New optional header facts on an invoice (all printed, none touch the ledger):
--   D.C # (dc_refs), Payment Terms, Due Date, Contact Person, Total Weight and a
--   per-invoice Note. The note starts as the company-wide default
--   (company.gst_invoice_note, set under Company settings) and can then be edited or
--   removed on each invoice; an empty note is not printed.
-- Existing invoices simply have NULL in the new columns and keep printing without them.

alter table public.invoices
  add column if not exists dc_refs text,
  add column if not exists payment_terms text,
  add column if not exists due_date date,
  add column if not exists contact_person text,
  add column if not exists total_weight text,
  add column if not exists print_note text;

alter table public.company add column if not exists gst_invoice_note text;

-- Set / change the printed details of a Posted invoice (blank clears a field).
-- Updates are audited by the generic audit trigger on invoices (who / when / old -> new).
create or replace function public.fn_set_invoice_details(
  p_invoice_id uuid,
  p_dc_refs text,
  p_payment_terms text,
  p_due_date date,
  p_contact_person text,
  p_total_weight text,
  p_print_note text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Only Owner or Accounts can edit Invoice details.';
  end if;

  select status into v_status from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.';
  end if;
  if v_status is distinct from 'Posted' then
    raise exception 'Only a Posted Invoice can be edited (this one is %).', coalesce(v_status, 'unknown');
  end if;

  update public.invoices
     set dc_refs        = nullif(left(btrim(coalesce(p_dc_refs, '')), 300), ''),
         payment_terms  = nullif(left(btrim(coalesce(p_payment_terms, '')), 300), ''),
         due_date       = p_due_date,
         contact_person = nullif(left(btrim(coalesce(p_contact_person, '')), 150), ''),
         total_weight   = nullif(left(btrim(coalesce(p_total_weight, '')), 60), ''),
         print_note     = nullif(left(btrim(coalesce(p_print_note, '')), 2000), '')
   where id = p_invoice_id
     and (dc_refs, payment_terms, due_date, contact_person, total_weight, print_note) is distinct from (
           nullif(left(btrim(coalesce(p_dc_refs, '')), 300), ''),
           nullif(left(btrim(coalesce(p_payment_terms, '')), 300), ''),
           p_due_date,
           nullif(left(btrim(coalesce(p_contact_person, '')), 150), ''),
           nullif(left(btrim(coalesce(p_total_weight, '')), 60), ''),
           nullif(left(btrim(coalesce(p_print_note, '')), 2000), ''));
end;
$$;

revoke all on function public.fn_set_invoice_details(uuid, text, text, date, text, text, text) from public, anon;
grant execute on function public.fn_set_invoice_details(uuid, text, text, date, text, text, text) to authenticated;
