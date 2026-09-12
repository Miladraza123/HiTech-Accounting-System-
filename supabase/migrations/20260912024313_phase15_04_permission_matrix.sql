-- ============================================================
-- Phase 15 part D: Configurable Permission Matrix (app-layer, DB stays
-- as the safety floor — see README for the scope decision). One row per
-- permission key, holding the array of non-Owner role codes currently
-- granted that action; Owner is always implicitly allowed and never
-- stored here. Seeded to reproduce today's exact hardcoded gates
-- exactly — this migration changes nobody's access, only makes it
-- editable going forward. Covers the core transactional
-- create/cancel/manage action on every business document; master-data/
-- setup CRUD (items, clients, warehouses, vehicles, bank accounts,
-- petty cash, import, chart of accounts) intentionally stays on its
-- existing stable Owner(+role) gate, not part of the matrix — documented
-- scope choice, not an oversight.
-- ============================================================

create table public.role_permissions (
  permission_key text primary key,
  role_codes text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

comment on table public.role_permissions is 'App-layer permission matrix. One row per action; role_codes lists which non-Owner roles are currently granted it. Owner is always implicitly allowed and never appears here. Every SQL function this backs still carries its own original hardcoded role check as an unchangeable floor — a role can only be granted here if the underlying database function already permits it; granting a role here that the DB does not allow will still be rejected at the database layer when attempted.';

create trigger trg_audit after insert or delete or update on public.role_permissions for each row execute function fn_audit_row();
create trigger trg_updated_at before update on public.role_permissions for each row execute function fn_set_updated_at();

alter table public.role_permissions enable row level security;
create policy p_select on public.role_permissions for select using (true);

create or replace function public.fn_set_role_permission(p_permission_key text, p_role_codes text[])
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_owner() then
    raise exception 'Sirf Owner Permission Matrix change kar sakta hai.';
  end if;
  update public.role_permissions
    set role_codes = coalesce(p_role_codes, '{}'), updated_by = auth.uid()
    where permission_key = p_permission_key;
  if not found then
    raise exception 'Unknown permission key: %', p_permission_key;
  end if;
end;
$function$;

insert into public.role_permissions (permission_key, role_codes) values
  ('query.manage', '{sales}'),
  ('quotation.manage', '{sales}'),
  ('sales_order.manage', '{sales}'),
  ('purchase_order.manage', '{store}'),
  ('delivery_challan.manage', '{dispatch}'),
  ('delivery_challan.dispute', '{dispatch,sales}'),
  ('job.manage', '{production}'),
  ('job.material.manage', '{production,store}'),
  ('product_template.manage', '{production}'),
  ('invoice.manage', '{accounts}'),
  ('supplier_bill.manage', '{accounts}'),
  ('payment.manage', '{accounts}'),
  ('expense.manage', '{accounts}'),
  ('fund_transfer.manage', '{accounts}'),
  ('journal_voucher.manage', '{accounts}'),
  ('sales_return.manage', '{accounts}'),
  ('purchase_return.manage', '{accounts,store}'),
  ('inventory_adjustment.request', '{store}'),
  ('stock_transfer.create', '{store}');
