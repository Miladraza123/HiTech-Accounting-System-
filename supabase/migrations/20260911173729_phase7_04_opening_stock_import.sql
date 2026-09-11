-- Opening Stock import — the one entity_type ('opening_stock') that was
-- planned into import_batches' own check constraint since Phase 0 and
-- explicitly promised "arrives with the Inventory module (Phase 3)" in
-- both the design discussion and the Import Wizard's own UI copy, but
-- never actually built. Closing that gap now, on the same "find by
-- code, post via the internal ledger function, error per-row" pattern
-- already used for opening_receivables/opening_payables.
--
-- Called once per row from the app (matching how
-- commitOpeningBalancesImportAction already works row-by-row so a
-- partial import can report per-row errors) — not batched — since the
-- Import Wizard's row-level error reporting depends on that shape.
create or replace function public.fn_import_opening_stock(
  p_item_code text,
  p_warehouse_code text,
  p_qty numeric,
  p_rate numeric,
  p_as_of_date date,
  p_ref_table text,
  p_ref_id uuid,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
  v_item_stocked boolean;
  v_warehouse_id uuid;
  v_ledger_id uuid;
  v_value numeric;
begin
  if not (public.is_owner() or public.has_role('accounts')) then
    raise exception 'Sirf Owner ya Accounts Opening Stock import kar sakte hain.';
  end if;
  if p_qty <= 0 then
    raise exception 'Qty zero se zyada honi chahiye.';
  end if;
  if p_rate < 0 then
    raise exception 'Rate negative nahi ho sakta.';
  end if;

  select id, is_stocked into v_item_id, v_item_stocked from public.items where item_code = p_item_code;
  if v_item_id is null then
    raise exception 'Item code "%" nahi mila.', p_item_code;
  end if;
  if not v_item_stocked then
    raise exception 'Item "%" stocked nahi hai (is_stocked = false) — stock ledger mein import nahi ho sakta.', p_item_code;
  end if;

  select id into v_warehouse_id from public.warehouses where code = p_warehouse_code;
  if v_warehouse_id is null then
    raise exception 'Warehouse code "%" nahi mila.', p_warehouse_code;
  end if;

  v_ledger_id := public._fn_post_stock_ledger(
    v_item_id, v_warehouse_id, 'OpeningStock', p_qty, p_rate, p_ref_table, p_ref_id, coalesce(p_notes, 'Opening stock')
  );

  v_value := round(p_qty * p_rate, 2);
  if v_value > 0 then
    perform public._fn_post_journal_entry_core(
      coalesce(p_as_of_date, current_date), coalesce(p_notes, 'Opening stock — ' || p_item_code), p_ref_table, p_ref_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '1310', 'party_id', null, 'debit', v_value, 'credit', 0, 'memo', 'Raw Material Inventory — opening'),
        jsonb_build_object('account_code', '1900', 'party_id', null, 'debit', 0, 'credit', v_value, 'memo', 'Opening Balance Equity')
      )
    );
  end if;

  return v_ledger_id;
end;
$$;

revoke execute on function public.fn_import_opening_stock(text, text, numeric, numeric, date, text, uuid, text) from public, anon;
grant execute on function public.fn_import_opening_stock(text, text, numeric, numeric, date, text, uuid, text) to authenticated;
