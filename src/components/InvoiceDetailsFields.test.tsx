import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EMPTY_INVOICE_DETAILS, InvoiceDetailsFields } from "./InvoiceDetailsFields";

describe("InvoiceDetailsFields", () => {
  it("shows every print-detail field with its value", () => {
    const html = renderToStaticMarkup(
      <InvoiceDetailsFields
        value={{ dc_refs: "1771 & 1774", payment_terms: "Within 30 Days", due_date: "2026-12-05", contact_person: "MUHAMMAD WAJIH", total_weight: "3,200 Kg", print_note: "Deduct 5.5% income tax" }}
        onChange={() => {}}
      />
    );
    for (const t of ["D.C # (delivery challan numbers)", "Payment Terms", "Due Date", "Contact Person (buyer)", "Total Weight", "Note printed on this invoice", "1771 &amp; 1774", "MUHAMMAD WAJIH", "3,200 Kg", "Deduct 5.5% income tax", 'value="2026-12-05"']) {
      expect(html).toContain(t);
    }
  });
  it("starts empty and can be disabled (offline / read-only)", () => {
    const html = renderToStaticMarkup(<InvoiceDetailsFields value={EMPTY_INVOICE_DETAILS} onChange={() => {}} disabled />);
    expect(html).toContain("disabled");
    expect(EMPTY_INVOICE_DETAILS.due_date).toBeNull();
  });
});
