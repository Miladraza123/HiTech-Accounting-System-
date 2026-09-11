-- Company (singleton row — one company, multiple warehouses)
create table public.company (
  id uuid primary key default '00000000-0000-0000-0000-000000000001',
  legal_name text not null,
  ntn text,
  strn text,
  address text,
  province text references public.provinces(code),
  phone text,
  email text,
  logo_path text,
  fiscal_year_start_month int not null default 7,
  base_currency text not null default 'PKR',
  default_sales_tax_pct numeric(5,2) not null default 18.00,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (id = '00000000-0000-0000-0000-000000000001')
);

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Numbering engine
create table public.numbering_sequences (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null unique,
  label text not null,
  prefix text not null,
  fy_reset boolean not null default true,
  last_reset_fy int,
  current_value bigint not null default 0,
  padding int not null default 4,
  updated_at timestamptz not null default now()
);

-- Units + conversions
create table public.units (
  code text primary key,
  name text not null
);

create table public.unit_conversions (
  from_unit text not null references public.units(code),
  to_unit text not null references public.units(code),
  factor numeric(18,6) not null,
  primary key (from_unit, to_unit)
);

-- Item master (shared by raw material, trading goods, fabricated products)
create table public.items (
  id uuid primary key default gen_random_uuid(),
  item_code text not null unique,
  description text not null,
  category text,
  spec text,
  base_unit text not null references public.units(code),
  hs_code text,
  tax_category text not null default 'standard' check (tax_category in ('standard','reduced','zero_rated','exempt')),
  is_stocked boolean not null default true,
  standard_cost numeric(18,4) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Party master (clients + suppliers share one table)
create table public.parties (
  id uuid primary key default gen_random_uuid(),
  party_type text not null check (party_type in ('client','supplier','both')),
  legal_name text not null,
  ntn text,
  strn text,
  cnic text,
  billing_address text,
  province text references public.provinces(code),
  credit_limit numeric(18,2) not null default 0,
  credit_days int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  row_version bigint not null default 1
);

create table public.party_contacts (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  name text not null,
  designation text,
  phone text,
  email text,
  is_primary boolean not null default false
);

create index idx_party_contacts_party on public.party_contacts(party_id);
create index idx_parties_type on public.parties(party_type);
