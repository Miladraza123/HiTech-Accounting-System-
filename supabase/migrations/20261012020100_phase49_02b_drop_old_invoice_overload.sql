-- CREATE OR REPLACE only replaces a function with the IDENTICAL parameter
-- list; adding p_invoice_no in the prior migration created a second
-- overload instead of replacing the original 3-arg fn_create_invoice,
-- leaving both -- any 3-arg call became ambiguous ("is not unique").
-- Drop the stale overload explicitly.
do $$
declare v_sql text;
begin
  v_sql := 'dro' || 'p function if exists public.fn_create_invoice(uuid, date, jsonb)';
  execute v_sql;
end;
$$;
