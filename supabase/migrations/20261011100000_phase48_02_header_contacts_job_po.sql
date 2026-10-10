-- Phase 48.02: letterhead header from company data, client PO on the Service Job.
--
-- * Company: second phone and second email (printed in the quotation / service
--   invoice header next to the first ones).
-- * Service job: client PO number, copied onto its service invoice.
-- * Quotations: the next quotation gets serial 5412.

alter table public.company
  add column if not exists phone2 text,
  add column if not exists email2 text;

alter table public.service_jobs
  add column if not exists client_po_no text;

-- Next quotation number: 5412 (only ever moves the counter forward).
update public.numbering_sequences
set current_value = 5411
where doc_type = 'QTN' and current_value < 5411;
