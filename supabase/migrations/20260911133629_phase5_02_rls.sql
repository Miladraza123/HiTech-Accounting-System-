alter table public.delivery_challans enable row level security;
alter table public.delivery_challan_lines enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.supplier_bills enable row level security;
alter table public.supplier_bill_lines enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;

-- Delivery Challan / POD: everyone reads; Owner + Dispatch write
create policy p_select on public.delivery_challans for select to authenticated using (true);
create policy p_insert on public.delivery_challans for insert to authenticated
  with check (public.is_owner() or public.has_role('dispatch'));
create policy p_update on public.delivery_challans for update to authenticated
  using (public.is_owner() or public.has_role('dispatch'))
  with check (public.is_owner() or public.has_role('dispatch'));

create policy p_select on public.delivery_challan_lines for select to authenticated using (true);
create policy p_insert on public.delivery_challan_lines for insert to authenticated
  with check (public.is_owner() or public.has_role('dispatch'));

-- Invoices: everyone reads; Owner + Accounts write
create policy p_select on public.invoices for select to authenticated using (true);
create policy p_insert on public.invoices for insert to authenticated
  with check (public.is_owner() or public.has_role('accounts'));
create policy p_update on public.invoices for update to authenticated
  using (public.is_owner() or public.has_role('accounts'))
  with check (public.is_owner() or public.has_role('accounts'));

create policy p_select on public.invoice_lines for select to authenticated using (true);
create policy p_insert on public.invoice_lines for insert to authenticated
  with check (public.is_owner() or public.has_role('accounts'));

-- Supplier Bills: everyone reads; Owner + Accounts write
create policy p_select on public.supplier_bills for select to authenticated using (true);
create policy p_insert on public.supplier_bills for insert to authenticated
  with check (public.is_owner() or public.has_role('accounts'));
create policy p_update on public.supplier_bills for update to authenticated
  using (public.is_owner() or public.has_role('accounts'))
  with check (public.is_owner() or public.has_role('accounts'));

create policy p_select on public.supplier_bill_lines for select to authenticated using (true);
create policy p_insert on public.supplier_bill_lines for insert to authenticated
  with check (public.is_owner() or public.has_role('accounts'));

-- Payments (both receipts and payments): everyone reads; Owner + Accounts write
create policy p_select on public.payments for select to authenticated using (true);
create policy p_insert on public.payments for insert to authenticated
  with check (public.is_owner() or public.has_role('accounts'));
create policy p_update on public.payments for update to authenticated
  using (public.is_owner() or public.has_role('accounts'))
  with check (public.is_owner() or public.has_role('accounts'));

create policy p_select on public.payment_allocations for select to authenticated using (true);
create policy p_insert on public.payment_allocations for insert to authenticated
  with check (public.is_owner() or public.has_role('accounts'));
