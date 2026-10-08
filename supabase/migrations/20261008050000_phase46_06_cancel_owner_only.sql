-- Phase 46.06: restrict Cancel/Close to Owner only, everywhere except the
-- three the user explicitly kept with the Sales role — Query, Quotation,
-- and Sales Order (fn_cancel_sales_order is deliberately untouched here;
-- Query/Quotation have no dedicated Cancel RPC to begin with, they move
-- through fn_set_query_status / their own status column instead).
--
-- Every other fn_cancel_*/fn_close_* function currently also accepts the
-- document's "owning" operational role (Accounts/Store/Production/
-- Dispatch/Sales). This migration removes that role branch so only
-- public.is_owner() passes, rewriting each function's existing body
-- in place (via pg_get_functiondef + a targeted text replace) rather than
-- retyping ~16 multi-hundred-line functions by hand — safer against
-- transcription mistakes, and CREATE OR REPLACE FUNCTION keeps the
-- function's OID (so existing GRANTs survive untouched). Each step raises
-- loudly if its expected old text isn't found, instead of silently no-op'ing.
do $do$
declare
  v_row record;
  v_def text;
  v_new_def text;
begin
  for v_row in
    select * from (values
      ('fn_cancel_expense',          'Only Owner or Accounts can cancel Expenses.',                        'Only Owner can cancel Expenses.'),
      ('fn_cancel_invoice',          'Only Owner or Accounts can cancel Invoices.',                        'Only Owner can cancel Invoices.'),
      ('fn_cancel_job',              'Only Owner or Production can cancel.',                                'Only Owner can cancel.'),
      ('fn_cancel_payment',          'Only Owner or Accounts can cancel Payments.',                        'Only Owner can cancel Payments.'),
      ('fn_cancel_purchase_order',   'Only Owner or Store can cancel.',                                     'Only Owner can cancel.'),
      ('fn_cancel_purchase_return',  'Only Owner, Accounts, or Store can cancel Purchase Returns.',        'Only Owner can cancel Purchase Returns.'),
      ('fn_cancel_sales_return',     'Only Owner or Accounts can cancel a Sales Return.',                  'Only Owner can cancel a Sales Return.'),
      ('fn_cancel_service_delivery', 'Sirf Owner ya Dispatch Service Delivery cancel kar sakte hain.',     'Sirf Owner Service Delivery cancel kar sakte hain.'),
      ('fn_cancel_service_invoice',  'Sirf Owner ya Accounts Service Invoice cancel kar sakte hain.',      'Sirf Owner Service Invoice cancel kar sakte hain.'),
      ('fn_cancel_service_job',      'Sirf Owner, Sales ya Store Service Job cancel kar sakte hain.',      'Sirf Owner Service Job cancel kar sakte hain.'),
      ('fn_cancel_stock_transfer',   'Only Owner or Store can cancel a Stock Transfer.',                   'Only Owner can cancel a Stock Transfer.'),
      ('fn_cancel_supplier_bill',    'Only Owner or Accounts can cancel a Supplier Bill.',                 'Only Owner can cancel a Supplier Bill.'),
      ('fn_close_purchase_order',    'Only Owner or Store can close a Purchase Order.',                    'Only Owner can close a Purchase Order.')
    ) as t(proname, old_msg, new_msg)
  loop
    select pg_get_functiondef(oid) into v_def
    from pg_proc where pronamespace = 'public'::regnamespace and proname = v_row.proname;

    if v_def is null then
      raise exception 'function % not found', v_row.proname;
    end if;

    v_new_def := regexp_replace(v_def, 'if not \(public\.is_owner\(\)[^\n\r]*?\) then', 'if not public.is_owner() then');
    if v_new_def = v_def then
      raise exception 'gate pattern not found/replaced in %', v_row.proname;
    end if;

    if position(v_row.old_msg in v_new_def) = 0 then
      raise exception 'message text not found in %: %', v_row.proname, v_row.old_msg;
    end if;
    v_new_def := replace(v_new_def, v_row.old_msg, v_row.new_msg);

    execute v_new_def;
  end loop;
end;
$do$;

-- fn_cancel_task: a different gate shape (task creator OR owner, not a
-- role check) — the creator no longer gets a free pass either, matching
-- "Owner only" for every non-exempt Cancel across the app.
do $do$
declare
  v_def text;
  v_new_def text;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc where pronamespace = 'public'::regnamespace and proname = 'fn_cancel_task';
  if v_def is null then
    raise exception 'fn_cancel_task not found';
  end if;

  v_new_def := regexp_replace(v_def, 'if not \(public\.is_owner\(\) or v_task\.created_by = auth\.uid\(\)\) then', 'if not public.is_owner() then');
  if v_new_def = v_def then
    raise exception 'fn_cancel_task gate not replaced';
  end if;

  if position('Only the task creator or Owner can cancel it.' in v_new_def) = 0 then
    raise exception 'fn_cancel_task message not found';
  end if;
  v_new_def := replace(v_new_def, 'Only the task creator or Owner can cancel it.', 'Only Owner can cancel a Task.');

  execute v_new_def;
end;
$do$;
