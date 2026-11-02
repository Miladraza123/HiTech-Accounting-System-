import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GstInvoiceDoc, gstInvoiceLineAmounts, type GstInvoiceDocProps } from "./GstInvoiceDoc";

const base: GstInvoiceDocProps = {
  invoiceNo: "INV-202627-0952",
  date: "5 October 2026",
  seller: { name: "HITECH ENGINEERING", ntn: "8890257-3", strn: "3277876152003", address: "Korangi, Karachi", phones: ["021-35158614", "0300-2435659"], email: "a@b.com" },
  buyer: { name: "QICT", ntn: "0823649-6", strn: "12-00", address: "Port Qasim", phone: "021-34739100", email: null, contactPerson: "MUHAMMAD WAJIH" },
  poNo: "QICT.PO.26.24703",
  dcRefs: "1771 & 1774",
  paymentTerms: "Within 30 Days from Inv. Date",
  dueDate: null,
  sectionLabel: "MATERIAL",
  lines: [
    { description: "RESIN & MAT USED FOR\n(Water proofing)", hsCode: "3907.9100\n7019.1500, 8481.8090", unit: "EA", qty: 4, rate: 270339, amount: 1081356, taxPct: 18 },
    { description: "SEALANT", hsCode: null, unit: "KG", qty: 12.5, rate: 301.4, amount: 3767.5, taxPct: 18 },
  ],
  totalWeight: "3,200 Kg",
  note: "Deduct 5.5% income tax",
  signatoryName: "MUHAMMAD ABBAS",
  headerCompany: { name: "HITECH ENGINEERING", phone: null, phone2: null, email: null, email2: null, address: null, ntn: "8890257-3", strn: "3277876152003" },
  logoUrl: null,
  footerUrl: null,
  signatureUrl: null,
  stampUrl: null,
};

describe("GstInvoiceDoc", () => {
  it("prints the example's boxes, columns, every HS code on its own line, JOB heading and totals", () => {
    const html = renderToStaticMarkup(<GstInvoiceDoc {...base} />);
    for (const t of ["Sales Tax Invoice / Sales Invoice", "Seller&#x27;s Detail", "Buyer&#x27;s Detail", "INV-202627-0952", "QICT.PO.26.24703", "1771 &amp; 1774", "Within 30 Days from Inv. Date", "Contact Person: MUHAMMAD WAJIH", "MATERIAL", ">JOB<", "Amount Ex. GST", "Amount Inc. GST", "Total Weight: 3,200 Kg", "Deduct 5.5% income tax", "FOR HITECH ENGINEERING", "MUHAMMAD ABBAS"]) {
      expect(html).toContain(t);
    }
    for (const c of ["3907.9100", "7019.1500", "8481.8090"]) expect(html).toContain(`<div>${c}</div>`);
  });
  it("shows decimals only when an amount has paisa", () => {
    const html = renderToStaticMarkup(<GstInvoiceDoc {...base} />);
    expect(html).toContain("1,081,356<"); // whole
    expect(html).toContain("194,644.08"); // tax has paisa
    expect(html).toContain("3,767.50");
  });
  it("totals equal the sum of the rounded per-line tax (what the ledger holds)", () => {
    const a = gstInvoiceLineAmounts({ amount: 1081356, taxPct: 18 });
    const b = gstInvoiceLineAmounts({ amount: 3767.5, taxPct: 18 });
    expect(a.tax).toBe(194644.08);
    expect(b.tax).toBe(678.15);
    const html = renderToStaticMarkup(<GstInvoiceDoc {...base} />);
    expect(html).toContain((a.tax + b.tax).toLocaleString("en-US", { minimumFractionDigits: 2 })); // 195,322.23
  });
  it("leaves out weight, note and contact person when not given", () => {
    const html = renderToStaticMarkup(<GstInvoiceDoc {...base} totalWeight={null} note="  " buyer={{ ...base.buyer, contactPerson: null }} />);
    expect(html).not.toContain("Total Weight");
    expect(html).not.toContain("gst-note\">");
    expect(html).not.toContain("Contact Person");
  });
});
