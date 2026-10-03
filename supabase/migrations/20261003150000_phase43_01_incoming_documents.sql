-- Phase 43.01 — Incoming Documents (email RFQ/PR/PO intake).
--
-- No inbound-email infrastructure exists in this app at all today (only
-- an outbound Gmail SMTP step inside the standalone nightly-backup
-- GitHub Action, confirmed by prior research this session) — this is
-- genuinely new. The webhook route (src/app/api/inbound-email/route.ts)
-- is unauthenticated by definition (the email provider calls it, not a
-- signed-in user), so it writes through the admin client, bypassing RLS
-- entirely — these tables accordingly have no insert policy for
-- `authenticated` at all; only read/update, for the department that
-- reviews incoming mail.
create table public.incoming_documents (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'email',
  from_address text,
  subject text,
  body_text text,
  received_at timestamptz not null default now(),
  status text not null default 'New' check (status in ('New', 'Reviewed', 'Converted', 'Dismissed')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  converted_query_id uuid references public.queries(id),
  created_at timestamptz not null default now()
);
create index idx_incoming_documents_status on public.incoming_documents(status);

create table public.incoming_document_attachments (
  id uuid primary key default gen_random_uuid(),
  incoming_document_id uuid not null references public.incoming_documents(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  content_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);
create index idx_incoming_document_attachments_doc on public.incoming_document_attachments(incoming_document_id);

alter table public.incoming_documents enable row level security;
alter table public.incoming_document_attachments enable row level security;

create policy p_select on public.incoming_documents for select to authenticated
  using (public.is_owner() or public.has_role('sales'));
create policy p_update on public.incoming_documents for update to authenticated
  using (public.is_owner() or public.has_role('sales'))
  with check (public.is_owner() or public.has_role('sales'));

create policy p_select on public.incoming_document_attachments for select to authenticated
  using (public.is_owner() or public.has_role('sales'));
