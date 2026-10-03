-- Phase 42.01 — Web Push subscriptions.
--
-- One row per browser/device a user has granted notification permission on
-- (a person can have several — phone + desktop). endpoint is unique per
-- the Push API spec, so re-subscribing the same device upserts in place
-- rather than piling up dead rows.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index idx_push_subscriptions_user on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
create policy p_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy p_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy p_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));
