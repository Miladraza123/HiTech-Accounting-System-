-- CREATE OR REPLACE cannot change a function's parameter signature — it
-- creates a second overload instead of replacing it. Phase 9 widened
-- fn_create_payment with two new optional trailing params, which left the
-- old 8-arg version still present alongside the new 10-arg version,
-- making any RPC call with exactly the original 8 named params ambiguous
-- (PostgREST/Postgres can't tell which overload to pick). Caught before
-- the frontend was updated to call it — dropping the stale overload now.
drop function if exists public.fn_create_payment(uuid, text, date, text, text, numeric, text, jsonb);
