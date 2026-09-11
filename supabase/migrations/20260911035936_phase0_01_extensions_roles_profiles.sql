-- Extensions
create extension if not exists pgcrypto;

-- Reference: Pakistan provinces / territories
create table public.provinces (
  code text primary key,
  name text not null
);
insert into public.provinces (code, name) values
  ('PB','Punjab'), ('SD','Sindh'), ('KP','Khyber Pakhtunkhwa'), ('BL','Balochistan'),
  ('IS','Islamabad Capital Territory'), ('GB','Gilgit-Baltistan'), ('AJK','Azad Jammu & Kashmir');

-- Roles (fixed set per the design blueprint §7)
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text
);
insert into public.roles (code, name, description) values
  ('owner','Owner','Full access to everything, including user & role management'),
  ('sales','Sales / CRM','Queries, Quotations, Sales Orders'),
  ('store','Store / Purchase','Purchase, GRN, Inventory'),
  ('production','Production','Fabrication / Job Orders'),
  ('accounts','Accounts','Invoicing, Payments, Ledger, Reports'),
  ('dispatch','Dispatch','Delivery Challan, Client Acceptance'),
  ('auditor','Auditor','Read-only access to everything, including audit trail');

-- Profile: extends auth.users with app-specific fields
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- User <-> Role (many-to-many: someone can be both Owner and Accounts, etc.)
create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id),
  primary key (user_id, role_id)
);

-- Auto-create a profile row whenever someone signs up
create or replace function public.fn_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.fn_handle_new_user();

-- Role-check helpers (SECURITY DEFINER so they bypass RLS on roles/user_roles
-- and never cause recursive-policy evaluation)
create or replace function public.has_role(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.code = p_code
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('owner');
$$;

-- One-time bootstrap: the first person to call this becomes Owner.
-- Blocked the moment an Owner already exists.
create or replace function public.fn_bootstrap_owner()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_role_id uuid;
begin
  select id into v_owner_role_id from public.roles where code = 'owner';
  if exists (select 1 from public.user_roles where role_id = v_owner_role_id) then
    raise exception 'An Owner is already assigned for this system.';
  end if;
  insert into public.user_roles (user_id, role_id, assigned_by)
  values (auth.uid(), v_owner_role_id, auth.uid());
end;
$$;

grant execute on function public.fn_bootstrap_owner() to authenticated;
grant execute on function public.has_role(text) to authenticated;
grant execute on function public.is_owner() to authenticated;
