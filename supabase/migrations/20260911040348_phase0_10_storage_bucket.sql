insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit)
values ('imports', 'imports', false, 26214400)
on conflict (id) do nothing;

create policy "attachments_read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments');
create policy "attachments_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and owner = (select auth.uid()));
create policy "attachments_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (owner = (select auth.uid()) or public.is_owner()));

create policy "imports_read" on storage.objects for select to authenticated
  using (bucket_id = 'imports' and (public.is_owner() or public.has_role('accounts')));
create policy "imports_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'imports' and (public.is_owner() or public.has_role('accounts')));
