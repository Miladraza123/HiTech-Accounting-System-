-- Phase 27: company letterhead branding. `company.logo_path` has existed
-- since Phase 0 but was never wired to an upload UI or shown on printed
-- documents — this adds the two missing companion assets and finally
-- wires all three in. Nullable/opt-in, same as items.reorder_level:
-- nothing changes for a deployment that never uploads anything.
alter table public.company
  add column signature_path text,
  add column stamp_path text;

comment on column public.company.signature_path is
  'Storage path (attachments bucket) of the authorized signature image, shown on printed documents only when explicitly included at print/download time.';
comment on column public.company.stamp_path is
  'Storage path (attachments bucket) of the company stamp image, shown on printed documents only when explicitly included at print/download time.';
