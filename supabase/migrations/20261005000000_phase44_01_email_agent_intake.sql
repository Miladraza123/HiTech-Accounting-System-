-- Phase 44.01 — Email Agent intake: structured fields on incoming_documents + trusted senders.
--
-- ADDITIVE ONLY. Every new column on incoming_documents is nullable or has a
-- constant default, and no existing column, policy, index or constraint is
-- touched. The Phase 43 Mailgun webhook flow keeps working exactly as before
-- (rows it creates simply get sender_trust = 'unknown' and no AI data).
--
-- The external "Email Agent" posts to the same /api/inbound-email webhook and
-- additionally sends: a stable message id (idempotency), the sender name and
-- address, the AI-detected document type, the AI-extracted fields (jsonb) and a
-- needs-review flag. It never approves, rejects or converts anything — that
-- stays with this app's own review flow.
alter table public.incoming_documents
  add column agent_message_id text,
  add column sender_name text,
  add column sender_email text,
  add column doc_type text check (doc_type in ('RFQ', 'PR', 'PO', 'Invoice', 'Other')),
  add column ai_data jsonb,
  add column ai_needs_review boolean not null default false,
  add column sender_trust text not null default 'unknown' check (sender_trust in ('trusted', 'untrusted', 'unknown'));

-- A retried delivery of the same email must not create a second row.
create unique index idx_incoming_documents_agent_message_id
  on public.incoming_documents(agent_message_id)
  where agent_message_id is not null;
create index idx_incoming_documents_sender_email
  on public.incoming_documents(lower(sender_email));

-- Senders the staff has marked as trusted. Emails from anyone else are still
-- accepted (nothing is dropped) but shown with an "Untrusted" badge.
create table public.trusted_senders (
  email text primary key check (email = lower(email)),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.trusted_senders enable row level security;

create policy p_select on public.trusted_senders for select to authenticated
  using (public.is_owner() or public.has_role('sales'));
create policy p_insert on public.trusted_senders for insert to authenticated
  with check (public.is_owner() or public.has_role('sales'));
create policy p_delete on public.trusted_senders for delete to authenticated
  using (public.is_owner());
