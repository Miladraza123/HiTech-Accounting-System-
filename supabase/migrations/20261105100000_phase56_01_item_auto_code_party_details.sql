-- Phase 56: (A) Item codes are assigned automatically and cannot be changed;
--           (B) a client/supplier's details can be edited, with contact people.
--
-- Nothing here rewrites existing rows: it adds a counter, triggers, functions and widens
-- which party columns the existing Smart Merge update may touch.

-- ======================================================================
-- A. Item codes
-- ======================================================================
-- The counter continues the numbers already in use: it starts at the highest all-digit
-- item code (1056 at the time of writing), so the next item is 1057. Codes that are not
-- all digits ("chuck", "gas wall") are ignored when picking the starting point.
insert into public.numbering_sequences (doc_type, label, prefix, fy_reset, current_value, padding, include_fy)
select 'ITM', 'Item code', '', false,
       coalesce((select max(item_code::bigint) from public.items where item_code ~ '^[0-9]{1,12}$'), 0),
       4, false
where not exists (select 1 from public.numbering_sequences where doc_type = 'ITM');

-- Next free code. Skips any number that already exists, so a code typed by hand earlier
-- (or imported) can never be handed out twice.
create or replace function public.fn_next_item_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_guard int := 0;
begin
  loop
    v_code := public.fn_get_next_number('ITM');
    exit when not exists (select 1 from public.items where item_code = v_code);
    v_guard := v_guard + 1;
    if v_guard > 10000 then
      raise exception 'Could not find a free item code.';
    end if;
  end loop;
  return v_code;
end;
$$;
revoke all on function public.fn_next_item_code() from public, anon;
grant execute on function public.fn_next_item_code() to authenticated;

-- An item saved without a code gets the next one. A code that is supplied (imports, restores)
-- is kept exactly as given.
create or replace function public.fn_items_auto_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if btrim(coalesce(new.item_code, '')) = '' then
    new.item_code := public.fn_next_item_code();
  else
    new.item_code := btrim(new.item_code);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_items_auto_code on public.items;
create trigger trg_items_auto_code before insert on public.items
  for each row execute function public.fn_items_auto_code();

-- Once an item exists, its code is fixed (stock, GRNs and documents refer to it). Signed-in app
-- users cannot change it; maintenance run directly in the database (no signed-in user) still can.
create or replace function public.fn_items_lock_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and new.item_code is distinct from old.item_code then
    raise exception 'An item''s code cannot be changed once it has been created.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_items_lock_code on public.items;
create trigger trg_items_lock_code before update on public.items
  for each row execute function public.fn_items_lock_code();

-- The offline-created item path used to insist on a typed code; a blank one now gets the next code.
do $patch$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.proname = 'fn_create_item_idempotent' and p.pronamespace = 'public'::regnamespace;
  if v_def is null then
    raise exception 'fn_create_item_idempotent not found';
  end if;
  if v_def not like '%Item code is required%' then
    return; -- already patched
  end if;
  v_new := regexp_replace(
    v_def,
    'if coalesce\(trim\(p_item_code\), ''''\) = '''' then\s+raise exception ''Item code is required\.'';\s+end if;',
    '-- a blank item code is filled in by trg_items_auto_code');
  if v_new = v_def then
    raise exception 'fn_create_item_idempotent patch did not apply';
  end if;
  execute v_new;
end
$patch$;

-- ======================================================================
-- B. Client / supplier details
-- ======================================================================
-- Smart Merge (conflict-aware, only changed fields are written) may now also edit the identity
-- and address columns of a party. Items: the code is no longer editable through it.
do $patch$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.proname = '_fn_smart_merge_editable_columns' and p.pronamespace = 'public'::regnamespace;
  if v_def is null then
    raise exception '_fn_smart_merge_editable_columns not found';
  end if;
  v_new := v_def;
  v_new := regexp_replace(v_new, 'when ''parties'' then array\[''credit_limit'', ''credit_days''\]',
    'when ''parties'' then array[''credit_limit'', ''credit_days'', ''legal_name'', ''ntn'', ''strn'', ''cnic'', ''billing_address'', ''province'']');
  v_new := regexp_replace(v_new, 'when ''items'' then array\[''item_code'', ', 'when ''items'' then array[');
  if v_new = v_def and v_def not like '%billing_address%' then
    raise exception '_fn_smart_merge_editable_columns patch did not apply';
  end if;
  if v_new <> v_def then
    execute v_new;
  end if;
end
$patch$;

-- Contact people (name, designation, phone, email). Exactly one can be the primary contact, whose
-- phone/email/name the invoice print and quotation Attn suggestions use.
create or replace function public.fn_save_party_contact(
  p_contact_id uuid,
  p_party_id uuid,
  p_name text,
  p_designation text,
  p_phone text,
  p_email text,
  p_is_primary boolean
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_name text := left(btrim(coalesce(p_name, '')), 150);
  v_email text := nullif(left(btrim(coalesce(p_email, '')), 150), '');
  v_id uuid;
  v_primary boolean := coalesce(p_is_primary, false);
  v_rows int;
begin
  if v_name = '' then
    raise exception 'The contact''s name is required.';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address does not look right.';
  end if;
  if not exists (select 1 from public.parties where id = p_party_id) then
    raise exception 'Client/supplier not found.';
  end if;
  -- the first contact of a party is its primary one
  if not exists (select 1 from public.party_contacts where party_id = p_party_id and id is distinct from p_contact_id) then
    v_primary := true;
  end if;

  if p_contact_id is null then
    if v_primary then
      update public.party_contacts set is_primary = false where party_id = p_party_id and is_primary;
    end if;
    insert into public.party_contacts (party_id, name, designation, phone, email, is_primary)
    values (p_party_id, v_name, nullif(left(btrim(coalesce(p_designation, '')), 100), ''),
            nullif(left(btrim(coalesce(p_phone, '')), 60), ''), v_email, v_primary)
    returning id into v_id;
  else
    if v_primary then
      update public.party_contacts set is_primary = false
       where party_id = p_party_id and is_primary and id <> p_contact_id;
    end if;
    update public.party_contacts
       set name = v_name,
           designation = nullif(left(btrim(coalesce(p_designation, '')), 100), ''),
           phone = nullif(left(btrim(coalesce(p_phone, '')), 60), ''),
           email = v_email,
           is_primary = v_primary
     where id = p_contact_id and party_id = p_party_id
     returning id into v_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'Contact not found, or you are not allowed to change it.';
    end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.fn_save_party_contact(uuid, uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.fn_save_party_contact(uuid, uuid, text, text, text, text, boolean) to authenticated;

-- Removing a contact: if it was the primary one, the next oldest becomes primary (Owner only, by RLS).
create or replace function public.fn_delete_party_contact(p_contact_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_party uuid;
  v_was_primary boolean;
  v_rows int;
begin
  delete from public.party_contacts where id = p_contact_id returning party_id, is_primary into v_party, v_was_primary;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Contact not found, or only the Owner can remove a contact.';
  end if;
  if v_was_primary then
    update public.party_contacts set is_primary = true
     where id = (select id from public.party_contacts where party_id = v_party order by name, id limit 1);
  end if;
end;
$$;
revoke all on function public.fn_delete_party_contact(uuid) from public, anon;
grant execute on function public.fn_delete_party_contact(uuid) to authenticated;

drop trigger if exists trg_audit on public.party_contacts;
create trigger trg_audit after insert or update or delete on public.party_contacts
  for each row execute function public.fn_audit_row();

-- Changing what a party is (client / supplier / both). Becoming "both" is always fine. Dropping a
-- role is refused while the party has documents or postings in that role.
create or replace function public.fn_change_party_type(p_party_id uuid, p_new_type text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_party public.parties;
  v_client_docs boolean;
  v_supplier_docs boolean;
  v_rows int;
begin
  if p_new_type not in ('client', 'supplier', 'both') then
    raise exception 'Type must be client, supplier or both.';
  end if;
  select * into v_party from public.parties where id = p_party_id for update;
  if v_party.id is null then
    raise exception 'Client/supplier not found.';
  end if;
  if v_party.party_type = p_new_type then
    return;
  end if;

  if p_new_type in ('client', 'both') and v_party.short_code is null then
    raise exception 'Set this client''s code first (client page, Document settings); quotations need it.';
  end if;

  v_client_docs := exists (select 1 from public.queries where party_id = p_party_id)
    or exists (select 1 from public.quotations where party_id = p_party_id)
    or exists (select 1 from public.sales_orders where party_id = p_party_id)
    or exists (select 1 from public.delivery_challans where party_id = p_party_id)
    or exists (select 1 from public.invoices where party_id = p_party_id)
    or exists (select 1 from public.sales_returns where party_id = p_party_id)
    or exists (select 1 from public.service_jobs where party_id = p_party_id)
    or exists (select 1 from public.service_deliveries where party_id = p_party_id)
    or exists (select 1 from public.payments where party_id = p_party_id and direction = 'receipt')
    or exists (select 1 from public.journal_lines jl join public.chart_of_accounts a on a.id = jl.account_id
               where jl.party_id = p_party_id and a.code = '1200');
  v_supplier_docs := exists (select 1 from public.purchase_orders where supplier_id = p_party_id)
    or exists (select 1 from public.grns where supplier_id = p_party_id)
    or exists (select 1 from public.supplier_bills where supplier_id = p_party_id)
    or exists (select 1 from public.purchase_returns where supplier_id = p_party_id)
    or exists (select 1 from public.payments where party_id = p_party_id and direction = 'payment')
    or exists (select 1 from public.journal_lines jl join public.chart_of_accounts a on a.id = jl.account_id
               where jl.party_id = p_party_id and a.code = '2100');

  if p_new_type = 'supplier' and v_client_docs then
    raise exception 'This party already has client documents (quotations, orders, invoices or receipts), so it must stay a client. Choose "Client + Supplier" instead.';
  end if;
  if p_new_type = 'client' and v_supplier_docs then
    raise exception 'This party already has supplier documents (purchase orders, bills or payments), so it must stay a supplier. Choose "Client + Supplier" instead.';
  end if;

  update public.parties set party_type = p_new_type, row_version = coalesce(row_version, 0) + 1 where id = p_party_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'You are not allowed to change this client/supplier.';
  end if;
end;
$$;
revoke all on function public.fn_change_party_type(uuid, text) from public, anon;
grant execute on function public.fn_change_party_type(uuid, text) to authenticated;
