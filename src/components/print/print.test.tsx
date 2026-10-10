import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { QuotationDoc, type QuotationDocProps } from "@/components/print/QuotationDoc";
import { ServiceInvoiceDoc, type ServiceInvoiceDocProps } from "@/components/print/ServiceInvoiceDoc";

const headerCompany = {
  name: "HiTech Engineering",
  phone: "+92 300 243 5659",
  phone2: "(+92) 21 351 586 14",
  email: "hitechengineering.pk1@gmail.com",
  email2: "hitechengineer.pk1.com",
  address: "R-74 Sector 31 B, KDA Employees Qouta Korangi, Near Industrial Area, Karachi.",
  ntn: "8890257-3",
  strn: "8890257-3",
};

const quotation: QuotationDocProps = {
  companyName: "HiTech Engineering",
  refNo: "HTE/TPFL/5412",
  date: "6-Oct-26",
  partyName: "Tri-Pack Films Limited",
  attn: "Mr. Atif Ali Tanoli",
  subject: "Quotation for supply of Spider,Coupling PR# 2400008883",
  lines: [{ description: "SPIDER,COUPLING,75,GEAR,RIM\nNylon Spider Coupling Pad\nType : GR-75\nImported", rate: 4800, qty: 4, unit: "NOS", tax_pct: 18, amount: 19200 }],
  subtotal: 19200,
  taxTotal: 3456,
  grandTotal: 22656,
  currency: "PKR",
  completionTime: "4 to 5 working week after receiving of purchase order",
  validityText: "7 DAYS",
  signatoryName: "MUHAMMAD ABBAS",
  headerCompany,
  logoUrl: process.env.LOGO ?? null,
  footerUrl: process.env.FTR ?? "/letterhead/footer.jpg",
  signatureUrl: process.env.SIG ?? null,
  stampUrl: null,
};

const invoice: ServiceInvoiceDocProps = {
  invoiceNo: "SRB 793",
  date: "6/10/2026",
  seller: { name: "HiTech Engineering", address: "R-74 Sector 31-B KDA Employees Quota Korangi Industrial Area, Karachi", phone: "0300-2435659", ntn: "8890257-3", sntn: "8890257-3" },
  buyer: { name: "Tri-Pack Films Ltd", address: "Plot # G-1to G-4,NW Industrial Zone Port Qasim Authority, Karachi", phone: "021-34720247-8", ntn: "0984495-3", sntn: "0984495-3" },
  clientPoNo: "4500101166",
  lines: [{ description: "Service at Chiller C/T # 02\nSR No.\nService at Chiller C/T # 02", qty: 1, rate: 350000, tax_pct: 15, amount: 350000 }],
  note: "Note: According to FBR Tax Laws please deduct 4% Income Tax U/s 153 (1) (b) (Engineering Services) and deposit in Government Treasury. After that please provide income tax challans.",
  signatoryName: "MUHAMMAD ABBAS",
  headerCompany,
  logoUrl: process.env.LOGO ?? null,
  footerUrl: process.env.FTR ?? "/letterhead/footer.jpg",
  signatureUrl: process.env.SIG ?? null,
  stampUrl: null,
};

describe("letterhead print documents", () => {
  it("quotation shows ref, attn, subject, the boxed totals and the terms", () => {
    const html = renderToStaticMarkup(<QuotationDoc {...quotation} />);
    if (process.env.DUMP_DIR) writeFileSync(`${process.env.DUMP_DIR}/quotation.html`, `<!doctype html><meta charset="utf-8"><body style="margin:0">${html}`);
    for (const t of ["HTE/TPFL/5412", "MR. ATIF ALI TANOLI", "SUBJECT: QUOTATION FOR SUPPLY OF SPIDER,COUPLING PR# 2400008883", "Dear Sir,", "4,800", "19,200", "ADD GST 18%", "PKR. 3,456", "PKR. 22,656", "JOB COMPLETION TIME:", "7 DAYS", "FOR HITECH ENGINEERING", "MUHAMMAD ABBAS"]) {
      expect(html).toContain(t);
    }
  });

  it("quotation hides Attn and the terms rows that are empty, and says GST without a rate when rates differ", () => {
    const html = renderToStaticMarkup(
      <QuotationDoc
        {...quotation}
        attn={null}
        completionTime={null}
        validityText={null}
        lines={[...quotation.lines, { description: "Labour", rate: 100, qty: 1, unit: null, tax_pct: 5, amount: 100 }]}
      />
    );
    expect(html).not.toContain("ATTN");
    expect(html).not.toContain("JOB COMPLETION TIME");
    expect(html).not.toContain("VALIDITY OF QUOTATION");
    expect(html).toContain("ADD GST<");
  });

  it("service invoice shows both parties, the PO number, the per-line tax and the totals", () => {
    const html = renderToStaticMarkup(<ServiceInvoiceDoc {...invoice} />);
    if (process.env.DUMP_DIR) writeFileSync(`${process.env.DUMP_DIR}/invoice.html`, `<!doctype html><meta charset="utf-8"><body style="margin:0">${html}`);
    for (const t of ["SST INVOICE", "INVOICE # SRB 793", "6/10/2026", "Tri-Pack Films Ltd", "4500101166", "SERVICE REQUIRED", "350,000", "52,500", "402,500", "FBR Tax Laws", "FOR HITECH ENGINEERING"]) {
      expect(html).toContain(t);
    }
  });

  it("builds the header from the company profile: both phones, both emails, address, NTN and STRN apart", () => {
    const html = renderToStaticMarkup(<QuotationDoc {...quotation} />);
    for (const t of ["+92 300 243 5659", "(+92) 21 351 586 14", "hitechengineering.pk1@gmail.com", "hitechengineer.pk1.com", "R-74 Sector 31 B", "NTN: 8890257-3", "STRN: 8890257-3"]) {
      expect(html).toContain(t);
    }
  });

  it("leaves out the header lines the company profile does not have, and has no footer banner without an image", () => {
    const html = renderToStaticMarkup(
      <ServiceInvoiceDoc {...invoice} headerCompany={{ ...headerCompany, phone2: null, email2: null, strn: null }} footerUrl={null} />
    );
    expect(html).not.toContain("(+92) 21 351 586 14");
    expect(html).not.toContain("hitechengineer.pk1.com");
    expect(html).not.toContain("STRN:");
    expect(html).toContain("NTN: 8890257-3");
    expect(html).not.toContain('class="lh-footer"');
  });
});
