-- Attachments followed none of the document access rules: the attachments
-- table and the storage bucket were readable by every signed-in role, and any
-- role could upload to any document. So Dispatch/Production could open a
-- payment slip or an invoice scan even though phase38_04 hid those documents,
-- and anyone could fetch the company's signature and stamp images.
--
-- Files live at <owner_table>/<owner_id>/<file> (attachments.ts) and the
-- letterhead images at company/<logo|signature|stamp>-<ts>.<ext>.

-- Who may see documents of a given type. Mirrors phase38_04's SELECT policies
-- (and src/lib/financeAccess.ts); types not listed stay open to every role.
create or replace function public.fn_can_access_doc_type(p_type text)
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when p_type in ('payments', 'expenses', 'contra_transfers', 'bank_accounts', 'petty_cash_funds', 'vehicles')
      then public.is_owner() or public.has_role('accounts') or public.has_role('auditor')
    when p_type in ('invoices', 'sales_returns')
      then public.is_owner() or public.has_role('accounts') or public.has_role('auditor') or public.has_role('sales')
    when p_type in ('supplier_bills', 'purchase_returns')
      then public.is_owner() or public.has_role('accounts') or public.has_role('auditor') or public.has_role('store')
    else true
  end;
$$;

revoke execute on function public.fn_can_access_doc_type(text) from public, anon;
grant execute on function public.fn_can_access_doc_type(text) to authenticated;

-- Attachment records: visible/addable only alongside the document itself.
alter policy p_select on public.attachments
  using (public.fn_can_access_doc_type(owner_table));
alter policy p_insert on public.attachments
  with check (uploaded_by = (select auth.uid()) and public.fn_can_access_doc_type(owner_table));

-- Files. The logo is printed on every document; signature and stamp only
-- for the roles that print signed documents (Accounts: invoice, Sales:
-- quotation, Store: PO, Dispatch: DC). Without access a print page simply
-- omits the image (getCompanyBrandingUrls returns null).
alter policy attachments_read on storage.objects
  using (
    bucket_id = 'attachments'
    and case
      when split_part(name, '/', 1) = 'company' then
        name like 'company/logo-%'
        or public.is_owner() or public.has_role('accounts') or public.has_role('sales')
        or public.has_role('store') or public.has_role('dispatch')
      else public.fn_can_access_doc_type(split_part(name, '/', 1))
    end
  );

-- Uploads: letterhead images are Owner-only (Setup > Company is Owner-only);
-- document files follow the document's audience.
alter policy attachments_write on storage.objects
  with check (
    bucket_id = 'attachments'
    and owner = (select auth.uid())
    and case
      when split_part(name, '/', 1) = 'company' then public.is_owner()
      else public.fn_can_access_doc_type(split_part(name, '/', 1))
    end
  );
