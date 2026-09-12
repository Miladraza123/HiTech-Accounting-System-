-- ============================================================
-- Bug fix: jobs.responsible_user_id referenced auth.users(id), unlike
-- every sibling "assigned/responsible person" column elsewhere in this
-- schema (tasks.assigned_to, vehicles.assigned_user_id,
-- petty_cash_funds.custodian_user_id), which all correctly reference
-- public.profiles(id) instead. Because of that mismatch, PostgREST had
-- NO valid relationship path to embed `profiles(full_name)` from jobs
-- at all (its select("*, ..., profiles(full_name)") join has no FK to
-- resolve against, since jobs' only auth.users-pointing columns are
-- responsible_user_id/created_by/updated_by, none of which reach
-- public.profiles directly) — so the Job Detail page's query silently
-- failed and the page rendered as a 404 for every single job. Never
-- caught before because the app had zero real jobs until this seeding
-- exercise created the first ones.
--
-- profiles.id is always a valid superset of auth.users(id) (every
-- signed-up user gets a profiles row via the existing signup trigger),
-- so re-pointing this FK is safe for all current data.
-- ============================================================

alter table public.jobs drop constraint jobs_responsible_user_id_fkey;
alter table public.jobs add constraint jobs_responsible_user_id_fkey
  foreign key (responsible_user_id) references public.profiles(id);
