-- Phase 31.04 — Report performance, part 3: AR/AP aging
--
-- Aging bucket, expressed exactly as src/lib/aging.ts computes it.
--
-- JS: days = floor((Date.now() - Date.parse(dueDate)) / 86400000), where
-- Date.parse on a bare 'YYYY-MM-DD' is UTC midnight; then
--   days <= 0 -> current, <= 30 -> 1-30, <= 60 -> 31-60, <= 90 -> 61-90,
--   else 90+.
-- `p_due::timestamp at time zone 'UTC'` reproduces that same UTC-midnight
-- instant, so the boundaries land on the same side in both languages.
-- Verified by comparing this function's output against the real JS
-- implementation on both sides of every boundary (0/1, 30/31, 60/61,
-- 90/91) — all identical.
create or replace function public.fn_aging_bucket(p_due date)
returns text
language sql
immutable
as $$
  select case
    when floor(extract(epoch from (now() - (p_due::timestamp at time zone 'UTC'))) / 86400) <= 0  then 'current'
    when floor(extract(epoch from (now() - (p_due::timestamp at time zone 'UTC'))) / 86400) <= 30 then 'd1_30'
    when floor(extract(epoch from (now() - (p_due::timestamp at time zone 'UTC'))) / 86400) <= 60 then 'd31_60'
    when floor(extract(epoch from (now() - (p_due::timestamp at time zone 'UTC'))) / 86400) <= 90 then 'd61_90'
    else 'd90_plus'
  end;
$$;

grant execute on function public.fn_aging_bucket(date) to authenticated;

-- /reports/ar-aging fetched every outstanding invoice, PLUS the whole
-- invoices table and the whole parties table, then joined and bucketed them
-- in JavaScript to produce one row per party. The output is bounded by the
-- number of parties; the input was not. This does the join and bucketing in
-- the database and returns only that per-party result. The Excel export
-- route shares the same function, so the two can never disagree.
--
-- security invoker: same RLS as the .select() calls it replaces.
create or replace function public.fn_ar_aging()
returns table (
  party_id uuid,
  name text,
  bucket_current numeric,
  bucket_1_30 numeric,
  bucket_31_60 numeric,
  bucket_61_90 numeric,
  bucket_90_plus numeric,
  total numeric
)
language sql
security invoker
stable
as $$
  with aged as (
    select p.id as party_id,
           p.legal_name,
           o.outstanding_amount,
           public.fn_aging_bucket((i.invoice_date + coalesce(p.credit_days, 0))::date) as bucket
    from public.invoice_outstanding o
    join public.invoices i on i.id = o.invoice_id
    join public.parties p on p.id = o.party_id
    where o.outstanding_amount > 0
  )
  select party_id,
         legal_name,
         coalesce(sum(outstanding_amount) filter (where bucket = 'current'), 0),
         coalesce(sum(outstanding_amount) filter (where bucket = 'd1_30'), 0),
         coalesce(sum(outstanding_amount) filter (where bucket = 'd31_60'), 0),
         coalesce(sum(outstanding_amount) filter (where bucket = 'd61_90'), 0),
         coalesce(sum(outstanding_amount) filter (where bucket = 'd90_plus'), 0),
         coalesce(sum(outstanding_amount), 0)
  from aged
  group by party_id, legal_name
  order by coalesce(sum(outstanding_amount), 0) desc;
$$;

grant execute on function public.fn_ar_aging() to authenticated;

-- /reports/ap-aging is the same shape on the supplier side.
create or replace function public.fn_ap_aging()
returns table (
  party_id uuid,
  name text,
  bucket_current numeric,
  bucket_1_30 numeric,
  bucket_31_60 numeric,
  bucket_61_90 numeric,
  bucket_90_plus numeric,
  total numeric
)
language sql
security invoker
stable
as $$
  with aged as (
    select p.id as party_id,
           p.legal_name,
           o.outstanding_amount,
           public.fn_aging_bucket((b.bill_date + coalesce(p.credit_days, 0))::date) as bucket
    from public.supplier_bill_outstanding o
    join public.supplier_bills b on b.id = o.supplier_bill_id
    join public.parties p on p.id = o.supplier_id
    where o.outstanding_amount > 0
  )
  select party_id,
         legal_name,
         coalesce(sum(outstanding_amount) filter (where bucket = 'current'), 0),
         coalesce(sum(outstanding_amount) filter (where bucket = 'd1_30'), 0),
         coalesce(sum(outstanding_amount) filter (where bucket = 'd31_60'), 0),
         coalesce(sum(outstanding_amount) filter (where bucket = 'd61_90'), 0),
         coalesce(sum(outstanding_amount) filter (where bucket = 'd90_plus'), 0),
         coalesce(sum(outstanding_amount), 0)
  from aged
  group by party_id, legal_name
  order by coalesce(sum(outstanding_amount), 0) desc;
$$;

grant execute on function public.fn_ap_aging() to authenticated;
