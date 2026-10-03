-- Phase 41.01 — Dispatch Go-Ahead / Accept / Complete + persisted,
-- actionable notifications.
--
-- src/lib/notifications.ts's existing bell is deliberately live-computed,
-- with no notifications table and no background job — correct for its
-- own three types (task due, credit limit, low stock), which are all
-- "is this condition currently true", re-derived every load so the bell
-- can never drift from the report pages it mirrors.
--
-- A dispatch go-ahead is different: it's a one-time EVENT (giver ->
-- specific dispatch person -> accept -> complete -> notify the giver
-- back), not a standing condition, so it needs an actual row that
-- persists past the moment it happened. This table is additive and used
-- ONLY by the new dispatch flow — the three existing live-derived types
-- are untouched.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id),
  type text not null,
  title text not null,
  description text,
  href text,
  related_table text,
  related_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_notifications_recipient on public.notifications(recipient_user_id, is_read);

alter table public.notifications enable row level security;
create policy p_select on public.notifications for select to authenticated
  using (recipient_user_id = (select auth.uid()) or public.is_owner());
create policy p_update on public.notifications for update to authenticated
  using (recipient_user_id = (select auth.uid()))
  with check (recipient_user_id = (select auth.uid()));

-- Realtime: lets the bell update live (no manual refresh) the moment a row
-- lands for the signed-in user. Respects the select policy above, so a
-- client only ever receives the INSERT broadcast for their own rows.
alter publication supabase_realtime add table public.notifications;

create table public.dispatch_go_aheads (
  id uuid primary key default gen_random_uuid(),
  delivery_challan_id uuid not null references public.delivery_challans(id),
  given_by uuid not null references auth.users(id),
  given_to uuid not null references auth.users(id),
  status text not null default 'Pending' check (status in ('Pending', 'Accepted', 'Completed')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz
);
create index idx_dga_dc on public.dispatch_go_aheads(delivery_challan_id);
create index idx_dga_given_to on public.dispatch_go_aheads(given_to, status);

alter table public.dispatch_go_aheads enable row level security;
-- Operational, not financial — same "everyone reads" the Delivery
-- Challan it's attached to already uses.
create policy p_select on public.dispatch_go_aheads for select to authenticated using (true);
create policy p_insert on public.dispatch_go_aheads for insert to authenticated
  with check (public.is_owner() or public.has_role('sales'));
create policy p_update on public.dispatch_go_aheads for update to authenticated
  using (given_to = (select auth.uid()) or public.is_owner())
  with check (given_to = (select auth.uid()) or public.is_owner());
