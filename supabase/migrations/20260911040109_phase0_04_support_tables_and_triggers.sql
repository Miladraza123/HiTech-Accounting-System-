create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  owner_table text not null,
  owner_id uuid not null,
  file_path text not null,
  file_type text,
  label text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now()
);
create index idx_attachments_owner on public.attachments(owner_table, owner_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id uuid,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  field text,
  old_value text,
  new_value text,
  actor_id uuid,
  at timestamptz not null default now()
);
create index idx_audit_log_table_row on public.audit_log(table_name, row_id);
create index idx_audit_log_actor on public.audit_log(actor_id);

create table public.login_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  login_at timestamptz not null default now(),
  logout_at timestamptz,
  ip_address text,
  device_info text,
  login_method text not null default 'password'
);
create index idx_login_sessions_user on public.login_sessions(user_id);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('clients','suppliers','opening_receivables','opening_payables','opening_stock')),
  source_file_path text,
  uploaded_by uuid references auth.users(id),
  status text not null default 'pending' check (status in ('pending','previewed','committed','failed','rolled_back')),
  row_count int not null default 0,
  error_report jsonb,
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

-- Generic updated_at maintainer
create or replace function public.fn_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_updated_at before update on public.company for each row execute function public.fn_set_updated_at();
create trigger trg_updated_at before update on public.warehouses for each row execute function public.fn_set_updated_at();
create trigger trg_updated_at before update on public.items for each row execute function public.fn_set_updated_at();
create trigger trg_updated_at before update on public.parties for each row execute function public.fn_set_updated_at();
create trigger trg_updated_at before update on public.chart_of_accounts for each row execute function public.fn_set_updated_at();
create trigger trg_updated_at before update on public.profiles for each row execute function public.fn_set_updated_at();

-- Generic audit trigger: logs every INSERT/UPDATE/DELETE field-by-field.
-- SECURITY DEFINER so it can always write to audit_log regardless of the
-- caller's own RLS grants.
create or replace function public.fn_audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_row_id uuid;
begin
  if TG_OP = 'INSERT' then
    v_row_id := (to_jsonb(new)->>'id')::uuid;
    insert into public.audit_log (table_name, row_id, action, actor_id)
    values (TG_TABLE_NAME, v_row_id, 'INSERT', auth.uid());
    return new;
  elsif TG_OP = 'DELETE' then
    v_row_id := (to_jsonb(old)->>'id')::uuid;
    insert into public.audit_log (table_name, row_id, action, actor_id)
    values (TG_TABLE_NAME, v_row_id, 'DELETE', auth.uid());
    return old;
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_row_id := (v_new->>'id')::uuid;
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key in ('updated_at','row_version') then
        continue;
      end if;
      if (v_old->>v_key) is distinct from (v_new->>v_key) then
        insert into public.audit_log (table_name, row_id, action, field, old_value, new_value, actor_id)
        values (TG_TABLE_NAME, v_row_id, 'UPDATE', v_key, v_old->>v_key, v_new->>v_key, auth.uid());
      end if;
    end loop;
    return new;
  end if;
end;
$$;

create trigger trg_audit after insert or update or delete on public.company for each row execute function public.fn_audit_row();
create trigger trg_audit after insert or update or delete on public.warehouses for each row execute function public.fn_audit_row();
create trigger trg_audit after insert or update or delete on public.items for each row execute function public.fn_audit_row();
create trigger trg_audit after insert or update or delete on public.parties for each row execute function public.fn_audit_row();
create trigger trg_audit after insert or update or delete on public.chart_of_accounts for each row execute function public.fn_audit_row();
create trigger trg_audit after insert or update or delete on public.user_roles for each row execute function public.fn_audit_row();
