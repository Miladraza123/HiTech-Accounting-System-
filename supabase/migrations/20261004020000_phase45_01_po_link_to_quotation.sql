-- Phase 45.01 — link an Incoming Document that is actually a client PO
-- (not a fresh RFQ/PR) to the Quotation it confirms, instead of forcing a
-- new Query. "Create Query" stays exactly as-is for RFQ/PR mail.
--
-- converted_sales_order_id mirrors the existing converted_query_id: an
-- Incoming Document converts to AT MOST ONE of a new Query or a Sales Order
-- against an existing Quotation, never both.
alter table public.incoming_documents
  add column converted_sales_order_id uuid references public.sales_orders(id);

-- Searchable list for the "PO Received — Link to Quotation" picker: only
-- Quotations actually awaiting a client reply (Sent/Accepted) are
-- candidates — a Draft was never sent out, and a Rejected/Expired one can't
-- legitimately have a PO land against it. security_invoker so the view
-- carries the querying user's own RLS on quotations/queries/parties rather
-- than the view owner's (same pattern as this schema's other views, e.g.
-- phase4_06_fix_view_security_invoker.sql).
create view public.po_linkable_quotations
with (security_invoker = true) as
select
  q.id,
  q.quotation_no,
  q.status,
  qr.query_no,
  p.legal_name as party_name
from public.quotations q
join public.queries qr on qr.id = q.query_id
join public.parties p on p.id = q.party_id
where q.status in ('Sent', 'Accepted');

comment on view public.po_linkable_quotations is 'Quotations a client PO can legitimately be linked against — used by the Incoming Documents "PO Received" picker.';
