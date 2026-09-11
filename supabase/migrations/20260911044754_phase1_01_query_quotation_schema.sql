-- Query sources (configurable lookup, keeps reporting clean)
create table public.query_sources (
  code text primary key,
  name text not null
);
insert into public.query_sources (code, name) values
  ('REFERRAL','Referral'), ('WEBSITE','Website'), ('COLD_CALL','Cold Call'),
  ('WALK_IN','Walk-in'), ('EXHIBITION','Exhibition'), ('EXISTING_CLIENT','Existing Client'),
  ('OTHER','Other');

-- Shared activity feed: Query follow-ups today, Customer 360 timeline later (Phase 6)
create table public.activity_timeline (
  id uuid primary key default gen_random_uuid(),
  owner_table text not null,
  owner_id uuid not null,
  event_type text not null check (event_type in ('note','status_change','followup','system')),
  note text,
  actor_id uuid references auth.users(id),
  at timestamptz not null default now(),
  next_followup_at date
);
create index idx_activity_owner on public.activity_timeline(owner_table, owner_id, at desc);

create table public.queries (
  id uuid primary key default gen_random_uuid(),
  query_no text not null unique,
  query_date date not null default current_date,
  party_id uuid not null references public.parties(id),
  requirement text not null,
  source text references public.query_sources(code),
  responsible_user_id uuid references auth.users(id),
  status text not null default 'Open' check (status in ('Open','Quoted','Won','Lost','OnHold')),
  next_followup_at date,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  row_version bigint not null default 1
);
create index idx_queries_party on public.queries(party_id);
create index idx_queries_status on public.queries(status);
create index idx_queries_responsible on public.queries(responsible_user_id);

create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  quotation_no text not null unique,
  query_id uuid not null references public.queries(id),
  party_id uuid not null references public.parties(id),
  responsible_user_id uuid references auth.users(id),
  status text not null default 'Draft' check (status in ('Draft','Sent','Accepted','Rejected','Expired')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create index idx_quotations_query on public.quotations(query_id);
create index idx_quotations_party on public.quotations(party_id);

create table public.quotation_revisions (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  rev_no int not null,
  terms text,
  validity_date date,
  delivery_terms text,
  payment_terms text,
  subtotal numeric(18,2) not null default 0,
  tax_total numeric(18,2) not null default 0,
  grand_total numeric(18,2) not null default 0,
  is_current boolean not null default true,
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (quotation_id, rev_no)
);
create index idx_qrev_quotation on public.quotation_revisions(quotation_id);
-- Only one current revision per quotation at a time
create unique index idx_qrev_one_current on public.quotation_revisions(quotation_id) where is_current;

create table public.quotation_lines (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.quotation_revisions(id) on delete cascade,
  item_id uuid references public.items(id),
  description text not null,
  qty numeric(18,3) not null check (qty > 0),
  unit text references public.units(code),
  rate numeric(18,4) not null check (rate >= 0),
  tax_pct numeric(5,2) not null default 0,
  amount numeric(18,2) generated always as (round(qty * rate, 2)) stored,
  sort_order int not null default 0
);
create index idx_qlines_revision on public.quotation_lines(revision_id);

create trigger trg_updated_at before update on public.queries for each row execute function public.fn_set_updated_at();
create trigger trg_updated_at before update on public.quotations for each row execute function public.fn_set_updated_at();

create trigger trg_audit after insert or update or delete on public.queries for each row execute function public.fn_audit_row();
create trigger trg_audit after insert or update or delete on public.quotations for each row execute function public.fn_audit_row();
create trigger trg_audit after insert or update or delete on public.quotation_revisions for each row execute function public.fn_audit_row();
