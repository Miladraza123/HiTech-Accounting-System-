-- phase38_06 let anyone who can SEE a document type also upload files to it,
-- which includes the read-only Auditor (and Backup Bot) roles. Uploading is a
-- write: require at least one role other than those two (Owner counts).
create or replace function public.fn_has_write_role()
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = (select auth.uid())
      and r.code not in ('auditor', 'backup')
  );
$$;

revoke execute on function public.fn_has_write_role() from public, anon;
grant execute on function public.fn_has_write_role() to authenticated;

alter policy p_insert on public.attachments
  with check (
    uploaded_by = (select auth.uid())
    and public.fn_has_write_role()
    and public.fn_can_access_doc_type(owner_table)
  );

alter policy attachments_write on storage.objects
  with check (
    bucket_id = 'attachments'
    and owner = (select auth.uid())
    and public.fn_has_write_role()
    and case
      when split_part(name, '/', 1) = 'company' then public.is_owner()
      else public.fn_can_access_doc_type(split_part(name, '/', 1))
    end
  );
