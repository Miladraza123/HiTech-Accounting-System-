import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EditInvoiceLineDescription } from "./EditInvoiceLineDescription";

describe("EditInvoiceLineDescription", () => {
  it("shows the description with an Edit link only when editing is allowed", () => {
    const withEdit = renderToStaticMarkup(<EditInvoiceLineDescription lineId="l1" invoiceId="i1" description={"Chiller\nline two"} canEdit />);
    expect(withEdit).toContain("Chiller");
    expect(withEdit).toContain("Edit");
    const readOnly = renderToStaticMarkup(<EditInvoiceLineDescription lineId="l1" invoiceId="i1" description="Chiller" canEdit={false} />);
    expect(readOnly).toContain("Chiller");
    expect(readOnly).not.toContain("Edit");
  });
  it("keeps line breaks in the displayed description", () => {
    const html = renderToStaticMarkup(<EditInvoiceLineDescription lineId="l1" invoiceId="i1" description="a" canEdit={false} />);
    expect(html).toContain("whitespace-pre-line");
  });
});
