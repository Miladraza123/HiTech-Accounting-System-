"use client";

import type { InvoiceDetailsInput } from "@/app/actions/invoices";

export const EMPTY_INVOICE_DETAILS: InvoiceDetailsInput = {
  dc_refs: "",
  payment_terms: "",
  due_date: null,
  contact_person: "",
  total_weight: "",
  print_note: "",
};

/**
 * The printed header facts of a GST invoice (D.C #, payment terms, due date, contact person, total weight,
 * note). Shared by the New Invoice form and the editor on a posted invoice. Everything is optional: a blank
 * field is simply not printed, and clearing the note removes it from the print.
 */
export function InvoiceDetailsFields({
  value,
  onChange,
  disabled = false,
}: {
  value: InvoiceDetailsInput;
  onChange: (next: InvoiceDetailsInput) => void;
  disabled?: boolean;
}) {
  const set = <K extends keyof InvoiceDetailsInput>(k: K, v: InvoiceDetailsInput[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">D.C # (delivery challan numbers)</span>
          <input type="text" value={value.dc_refs} onChange={(e) => set("dc_refs", e.target.value)} disabled={disabled} maxLength={300} placeholder="e.g. 1771 & 1774" className="input" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Payment Terms</span>
          <input type="text" value={value.payment_terms} onChange={(e) => set("payment_terms", e.target.value)} disabled={disabled} maxLength={300} placeholder="e.g. Within 30 Days from Inv. Date" className="input" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Due Date</span>
          <input type="date" value={value.due_date ?? ""} onChange={(e) => set("due_date", e.target.value || null)} disabled={disabled} className="input" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Contact Person (buyer)</span>
          <input type="text" value={value.contact_person} onChange={(e) => set("contact_person", e.target.value)} disabled={disabled} maxLength={150} className="input" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Total Weight</span>
          <input type="text" value={value.total_weight} onChange={(e) => set("total_weight", e.target.value)} disabled={disabled} maxLength={60} placeholder="e.g. 3,200 Kg" className="input" />
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Note printed on this invoice</span>
        <textarea
          value={value.print_note}
          onChange={(e) => set("print_note", e.target.value)}
          disabled={disabled}
          rows={3}
          maxLength={2000}
          placeholder="Starts as the default note from Company settings. Edit it, or clear it so no note is printed."
          className="input resize-y"
        />
      </label>
    </div>
  );
}
